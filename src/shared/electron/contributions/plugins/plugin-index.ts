import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { ManifestError, parsePluginManifest, PluginManifest } from '@shared/api/plugin-manifest';
import { logger } from '../../logger';
import SEED_INDEX from './curated-plugins.json';

// The curated index: the list of plugins Studio offers, as data rather than as code.
//
// It exists in two copies of the same document. One is compiled into the application, so a machine
// that has never been online still has a catalogue to install from. The other is published, so a new
// plugin or a bumped version reaches users without waiting for a Studio release. Whichever carries the
// higher revision wins — see `PluginIndex`.
//
// It is deliberately *curated*, not open. Every entry names an archive that will be downloaded and
// executed, so what is on the list is a decision somebody made, not a decision anybody can make by
// publishing. That is the whole distinction between this and a registry, and it is why the fetched
// document is only ever read through the same validator a sideloaded `plugin.json` goes through.

/**
 * Where the published index lives. `main` rather than a release tag on purpose: the point of fetching
 * is that the list can change between Studio releases, so pinning it to one would defeat it.
 */
const DEFAULT_INDEX_URL: string =
  'https://raw.githubusercontent.com/onix-labs/onixlabs-studio/main/plugins/index.json';

/**
 * The environment variable that repoints the index, for development and for testing against a local
 * copy. Deliberately not a setting: the index decides what code Studio will offer to download, so
 * moving it is an operator's act rather than a preference, and a preference is one mis-click from a
 * list somebody else controls.
 */
const INDEX_URL_VARIABLE: string = 'STUDIO_PLUGIN_INDEX_URL';

/**
 * The file the last successfully fetched index is kept in, under the user-data directory.
 */
const CACHE_FILE: string = 'plugin-index.json';

/**
 * The largest index body that will be parsed. A curated list of plugins is kilobytes; anything at this
 * scale is not the document we asked for, and refusing it beats handing it to a JSON parser.
 */
const MAXIMUM_BODY_BYTES: number = 1024 * 1024;

/**
 * A minimal response shape, so this module depends on neither DOM nor Node fetch types. Mirrors the
 * seam the model catalogue and the package registries use.
 */
export interface IndexResponse {
  /**
   * Gets whether the status is in the success range.
   */
  readonly ok: boolean;

  /**
   * Gets the HTTP status code.
   */
  readonly status: number;

  /**
   * Reads the body as text.
   * @returns Returns the body.
   */
  text(): Promise<string>;
}

/**
 * A minimal fetch signature, injected so the index is testable without a network.
 */
export type IndexFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<IndexResponse>;

/**
 * A parsed index document: which revision it is, what validated, and what did not.
 */
export interface PluginIndexDocument {
  /**
   * Gets the document's revision, which decides whether it supersedes another copy.
   */
  readonly revision: number;

  /**
   * Gets the entries that validated.
   */
  readonly manifests: readonly PluginManifest[];

  /**
   * Gets the reasons entries were refused, empty when every entry validated.
   */
  readonly errors: readonly ManifestError[];
}

/**
 * Validates an untrusted value as an index document.
 *
 * One bad entry does not spoil the document — it is reported and skipped, exactly as a broken plugin in
 * the sideload directory costs the user that plugin and nothing else. A bad *envelope* is a different
 * matter and is refused outright: if the thing is not shaped like an index, nothing in it can be
 * trusted to be shaped like a plugin either.
 * @param value The parsed JSON to validate.
 * @returns Returns the document, or null when the envelope is not one.
 */
export function parsePluginIndex(value: unknown): PluginIndexDocument | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const source: { revision?: unknown; plugins?: unknown } = value;
  if (typeof source.revision !== 'number' || !Number.isInteger(source.revision)) {
    return null;
  }
  if (!Array.isArray(source.plugins)) {
    return null;
  }
  const manifests: PluginManifest[] = [];
  const errors: ManifestError[] = [];
  const seen: Set<string> = new Set<string>();
  source.plugins.forEach((entry: unknown, index: number): void => {
    const result: ReturnType<typeof parsePluginManifest> = parsePluginManifest(entry);
    if (result.manifest === null) {
      for (const error of result.errors) {
        errors.push({ path: `plugins[${index}].${error.path}`, message: error.message });
      }
      return;
    }
    // The same rule the catalogue applies across sources, applied within one document: the first entry
    // under an id is the one that counts, and the collision is said out loud rather than resolved by
    // renaming something the author chose.
    if (seen.has(result.manifest.id)) {
      errors.push({ path: `plugins[${index}].id`, message: `duplicates '${result.manifest.id}'` });
      return;
    }
    seen.add(result.manifest.id);
    manifests.push(result.manifest);
  });
  return { revision: source.revision, manifests, errors };
}

/**
 * Gets the URL the index is fetched from, honouring the environment override.
 * @returns Returns the index URL.
 */
export function pluginIndexUrl(): string {
  const override: string | undefined = process.env[INDEX_URL_VARIABLE];
  return override !== undefined && override.length > 0 ? override : DEFAULT_INDEX_URL;
}

/**
 * Fetches an index over the network, the default {@link IndexFetch}.
 * @param url The URL to fetch.
 * @param init The request options.
 * @returns Returns the response.
 */
async function fetchIndex(url: string, init?: { signal?: AbortSignal }): Promise<IndexResponse> {
  const response: Response = await fetch(url, { signal: init?.signal });
  return { ok: response.ok, status: response.status, text: (): Promise<string> => response.text() };
}

/**
 * Studio's curated plugin index: the compiled-in copy, the fetched copy, and the rule deciding which
 * of them is in force.
 *
 * The rule is a revision comparison rather than a timestamp, because "newer" has to mean something the
 * publisher controls: upgrading Studio ships a seed that may well be newer than a cache fetched months
 * ago, and a cache fetched yesterday from an index that has not moved is not an improvement on it.
 * Highest revision wins, and the seed wins ties — it is the copy that shipped with this build.
 *
 * What is fetched does **not** take effect until the next launch. Registering a language server
 * mid-session is easy; unregistering one out from under a running session is not, and the sideload
 * directory already made that choice for the same reason. A refresh writes the cache and says so.
 */
export class PluginIndex {
  /**
   * Holds the file the fetched copy is cached in.
   */
  private readonly cacheFile: string;

  /**
   * Holds the URL the index is fetched from.
   */
  private readonly url: string;

  /**
   * Holds the fetch used to retrieve it.
   */
  private readonly http: IndexFetch;

  /**
   * Holds the document in force for this launch, resolved once on construction.
   */
  private readonly document: PluginIndexDocument;

  /**
   * Initializes a new instance of the {@link PluginIndex} class.
   * @param directory The directory the cache lives in (the user-data directory).
   * @param url The URL to fetch from; defaults to the published index.
   * @param http The fetch to retrieve it with; defaults to the network.
   */
  public constructor(
    directory: string,
    url: string = pluginIndexUrl(),
    http: IndexFetch = fetchIndex,
  ) {
    this.cacheFile = path.join(directory, CACHE_FILE);
    this.url = url;
    this.http = http;
    this.document = this.resolve();
  }

  /**
   * Gets the plugins the index offers this launch.
   * @returns Returns the manifests.
   */
  public manifests(): readonly PluginManifest[] {
    return this.document.manifests;
  }

  /**
   * Gets the revision in force this launch.
   * @returns Returns the revision.
   */
  public revision(): number {
    return this.document.revision;
  }

  /**
   * Fetches the published index and caches it when it supersedes what is in force.
   *
   * Every failure is survivable and none of them is the user's problem: an unreachable index, a private
   * repository, a body that is not the document we expected — each leaves the copy already in force
   * exactly as it was. That is what makes fetching safe to do at all.
   * @param signal Abandons the fetch when signalled.
   * @returns Returns true when a newer index was cached, and so will be in force next launch.
   */
  public async refresh(signal?: AbortSignal): Promise<boolean> {
    if (!this.url.startsWith('https://')) {
      logger.warn('PluginIndex', `Refusing to fetch the index over a non-https URL: ${this.url}`);
      return false;
    }
    let body: string;
    try {
      const response: IndexResponse = await this.http(this.url, { signal });
      if (!response.ok) {
        logger.info(
          'PluginIndex',
          `The index is unavailable (${response.status}); keeping what we have`,
        );
        return false;
      }
      body = await response.text();
    } catch (error: unknown) {
      logger.info('PluginIndex', 'Could not reach the plugin index; keeping what we have', error);
      return false;
    }
    if (body.length > MAXIMUM_BODY_BYTES) {
      logger.warn('PluginIndex', `Refused an index of ${body.length} bytes as implausible`);
      return false;
    }
    const fetched: PluginIndexDocument | null = this.read(body, this.url);
    if (fetched === null) {
      return false;
    }
    if (fetched.revision <= this.document.revision) {
      logger.debug(
        'PluginIndex',
        `The published index is revision ${fetched.revision}; revision ${this.document.revision} is already in force`,
      );
      return false;
    }
    try {
      writeFileSync(this.cacheFile, body, { encoding: 'utf8', mode: 0o600 });
    } catch (error: unknown) {
      logger.error('PluginIndex', 'Could not cache the plugin index', error);
      return false;
    }
    logger.info(
      'PluginIndex',
      `Cached index revision ${fetched.revision} with ${fetched.manifests.length} plugins; it takes effect on the next launch`,
    );
    return true;
  }

  /**
   * Decides which copy of the index is in force: the cached one when it is genuinely newer than the
   * one this build shipped with, and the seed otherwise.
   * @returns Returns the document in force.
   */
  private resolve(): PluginIndexDocument {
    const seed: PluginIndexDocument = this.validate(SEED_INDEX, 'the bundled index') ?? {
      revision: 0,
      manifests: [],
      errors: [],
    };
    const cached: PluginIndexDocument | null = this.readCache();
    if (cached === null || cached.revision <= seed.revision) {
      logger.info(
        'PluginIndex',
        `Using bundled index revision ${seed.revision} (${seed.manifests.length} plugins)`,
      );
      return seed;
    }
    logger.info(
      'PluginIndex',
      `Using cached index revision ${cached.revision} (${cached.manifests.length} plugins)`,
    );
    return cached;
  }

  /**
   * Reads the cached copy, treating an absent or unreadable cache as no cache at all.
   * @returns Returns the cached document, or null.
   */
  private readCache(): PluginIndexDocument | null {
    try {
      if (!existsSync(this.cacheFile)) {
        return null;
      }
      return this.read(readFileSync(this.cacheFile, 'utf8'), this.cacheFile);
    } catch (error: unknown) {
      logger.warn('PluginIndex', 'Could not read the cached plugin index', error);
      return null;
    }
  }

  /**
   * Parses one copy of the index from its text.
   * @param body The document text.
   * @param origin Where it came from, for the log.
   * @returns Returns the document, or null when it is not usable.
   */
  private read(body: string, origin: string): PluginIndexDocument | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (error: unknown) {
      logger.warn('PluginIndex', `${origin} is not readable JSON`, error);
      return null;
    }
    return this.validate(parsed, origin);
  }

  /**
   * Validates one copy of the index, reporting whatever it had to refuse.
   *
   * A document whose every entry was refused is itself refused. One bad plugin among many is a bad
   * plugin; *all* of them being bad means this is not the document we think it is, and acting on it
   * would replace a working catalogue with an empty one.
   * @param parsed The parsed document.
   * @param origin Where it came from, for the log.
   * @returns Returns the document, or null when it is not usable.
   */
  private validate(parsed: unknown, origin: string): PluginIndexDocument | null {
    const document: PluginIndexDocument | null = parsePluginIndex(parsed);
    if (document === null) {
      logger.warn('PluginIndex', `${origin} is not a plugin index`);
      return null;
    }
    for (const error of document.errors) {
      logger.warn('PluginIndex', `Refused an entry in ${origin}: ${error.path} ${error.message}`);
    }
    if (document.manifests.length === 0 && document.errors.length > 0) {
      logger.warn('PluginIndex', `Refused ${origin}: every entry in it was invalid`);
      return null;
    }
    return document;
  }
}
