import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  ManifestError,
  ManifestResult,
  parsePluginManifest,
  PLUGIN_API_VERSION,
  PluginManifest,
} from '@shared/api/plugin-manifest';
import { compareStudioVersions } from '@shared/api/studio-version';
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
//
// An entry may offer several releases of its plugin, so that a build implementing an older plugin API
// still installs the newest release it can run rather than whichever one it shipped with. The entry's
// own top-level fields are its newest release, in exactly the single-release shape every build has
// always read; older releases go in an optional `releases` list beside them, which builds that predate
// it ignore as an unknown field. So the format only ever grows: an old build reads a new index as it
// always did, and a new build reads an old index as an entry with one release.

/**
 * Where the published index lives: the seed file itself, served from the default branch.
 *
 * One file rather than two. A published copy kept alongside the compiled-in copy is a published copy
 * that drifts from it, and the failure that produces — Studio offering a version it will not install —
 * is invisible until someone tries. The cost is that this path is now public API: moving the file
 * breaks the fetch for every build already out there.
 *
 * `main` rather than a release tag on purpose. The point of fetching is that the list can change
 * between Studio releases, so pinning it to one would defeat it.
 */
const DEFAULT_INDEX_URL: string =
  'https://raw.githubusercontent.com/onix-labs/onixlabs-studio/main/' +
  'src/shared/electron/contributions/plugins/curated-plugins.json';

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

  /**
   * Gets the ids of the entries that were refused, where an entry said what it was.
   */
  readonly refused: readonly string[];
}

/**
 * One release of a plugin an index entry offers, before it is validated.
 */
export interface PluginReleaseCandidate {
  /**
   * Gets the dotted path the release sits at in the document, for failures.
   */
  readonly path: string;

  /**
   * Gets the release as a whole manifest: the entry's own fields with the release's laid over them.
   */
  readonly value: unknown;
}

/**
 * The outcome of choosing which of an entry's releases this build installs.
 */
export interface PluginReleaseSelection {
  /**
   * Gets the release chosen, or null when this build can run none of them.
   */
  readonly manifest: PluginManifest | null;

  /**
   * Gets the reasons releases were refused that are worth saying out loud.
   */
  readonly errors: readonly ManifestError[];
}

/**
 * The fields every listed release must state for itself rather than inherit from its entry. They are
 * what tells one release from another: inheriting the entry's provision would install the newest
 * payload under an older release's version, and inheriting its API version would defeat the point.
 */
const RELEASE_OWN_FIELDS: readonly string[] = ['version', 'apiVersion', 'provision'];

/**
 * The path the manifest validator reports a release this build cannot honour under, alone and before
 * anything else — recognised so that this expected refusal is told apart from a malformed release.
 */
const INCOMPATIBLE_PATH: string = 'apiVersion';

/**
 * Gets the id an entry claims, before it is trusted with anything else.
 * @param entry The entry.
 * @returns Returns the id, or null when it names none.
 */
function claimedId(entry: unknown): string | null {
  if (typeof entry !== 'object' || entry === null) {
    return null;
  }
  const id: unknown = (entry as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Determines whether a value is a plain JSON object.
 * @param value The candidate.
 * @returns Returns true when it is an object that is neither null nor an array.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The fields the curated index keeps as catalogue facts about a plugin rather than as part of any one
 * release (#1612): what it is licensed under, and where its source and home are. They hold for every
 * release an entry lists, so a listed release inherits them and its `plugin.json` need not carry them.
 */
export const CATALOGUE_FACTS: readonly string[] = ['licence', 'repository', 'homepage'];

/**
 * Sets a manifest's catalogue facts aside, to compare it as a release: an index entry with its
 * plugin's `plugin.json`, which says nothing of them.
 * @param value The manifest, as JSON.
 * @returns Returns it without {@link CATALOGUE_FACTS}.
 */
export function withoutCatalogueFacts(value: unknown): unknown {
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([key]: [string, unknown]): boolean => !CATALOGUE_FACTS.includes(key),
    ),
  );
}

/**
 * Lists the releases an index entry offers, newest-first as far as the publisher wrote them.
 *
 * The entry itself is always the first: its top-level fields are the single release every build reads,
 * including the builds that predate `releases` and ignore the field. Each element of `releases` is laid
 * over the entry, so a release states only what differs from it — its `version`, `apiVersion` and
 * `provision`, always, and its `contributes`, `requires` or description when those differ too (a
 * first-party release, in practice, carries its whole `plugin.json` but for the id, and a spec holds
 * it to that file at its tag). It can never name a different plugin.
 * @param entry The untrusted entry.
 * @param index The entry's position in the document, for failures.
 * @param errors Collects the reasons a listed release is malformed.
 * @returns Returns the releases to choose between.
 */
export function pluginReleaseCandidates(
  entry: unknown,
  index: number,
  errors: ManifestError[] = [],
): PluginReleaseCandidate[] {
  const path: string = `plugins[${index}]`;
  if (!isRecord(entry)) {
    return [{ path, value: entry }];
  }
  const { releases, ...latest }: Record<string, unknown> = entry;
  const candidates: PluginReleaseCandidate[] = [{ path, value: latest }];
  if (releases === undefined) {
    return candidates;
  }
  if (!Array.isArray(releases)) {
    errors.push({ path: `${path}.releases`, message: 'must be an array of releases' });
    return candidates;
  }
  releases.forEach((release: unknown, position: number): void => {
    const releasePath: string = `${path}.releases[${position}]`;
    if (!isRecord(release)) {
      errors.push({ path: releasePath, message: 'must be an object' });
      return;
    }
    if ('id' in release && release['id'] !== latest['id']) {
      errors.push({ path: `${releasePath}.id`, message: 'must not name a different plugin' });
      return;
    }
    const missing: readonly string[] = RELEASE_OWN_FIELDS.filter(
      (field: string): boolean => !(field in release),
    );
    if (missing.length > 0) {
      for (const field of missing) {
        errors.push({
          path: `${releasePath}.${field}`,
          message: 'must be stated by the release itself',
        });
      }
      return;
    }
    // A release cannot carry releases of its own: the list is one level deep, owned by the entry.
    const own: Record<string, unknown> = Object.fromEntries(
      Object.entries(release).filter(([key]: [string, unknown]): boolean => key !== 'releases'),
    );
    candidates.push({ path: releasePath, value: { ...latest, ...own, id: latest['id'] } });
  });
  return candidates;
}

/**
 * Chooses which of an entry's releases this build installs: the highest version whose plugin API it
 * can honour.
 *
 * Highest by version precedence rather than by position, so the order a publisher happens to list
 * releases in cannot make a build install an older one than it could run; a prerelease ranks below the
 * release it leads up to, as everywhere else. Two releases claiming the same version resolve to the
 * one listed first, the entry's own fields before `releases`. The ordering is Studio's own version
 * precedence: semver with prereleases, and forgiving of versions that are not semver (rust-analyzer's
 * are dates), which a plugin's own version is free to be.
 *
 * A release refused only because it needs a newer API than this build implements is the expected case
 * — it is why the list exists — so when another release stands in for it, that refusal is not reported.
 * Anything else wrong with a release is a publishing mistake, and is.
 * @param entry The untrusted entry.
 * @param index The entry's position in the document, for failures.
 * @param supported The plugin API this build implements; see {@link parsePluginManifest} for why a
 * value above {@link PLUGIN_API_VERSION} is meaningless.
 * @returns Returns the release chosen and the reasons worth reporting.
 */
export function selectPluginRelease(
  entry: unknown,
  index: number,
  supported: string = PLUGIN_API_VERSION,
): PluginReleaseSelection {
  const structural: ManifestError[] = [];
  const candidates: readonly PluginReleaseCandidate[] = pluginReleaseCandidates(
    entry,
    index,
    structural,
  );
  const incompatible: ManifestError[] = [];
  const malformed: ManifestError[] = [];
  let chosen: PluginManifest | null = null;
  for (const candidate of candidates) {
    const result: ManifestResult = parsePluginManifest(candidate.value, supported);
    const located: ManifestError[] = result.errors.map((error: ManifestError): ManifestError => ({
      path: `${candidate.path}.${error.path}`,
      message: error.message,
    }));
    if (result.manifest === null) {
      const onlyIncompatible: boolean =
        result.errors.length === 1 && result.errors[0].path === INCOMPATIBLE_PATH;
      (onlyIncompatible ? incompatible : malformed).push(...located);
      continue;
    }
    if (chosen === null || compareStudioVersions(result.manifest.version, chosen.version) > 0) {
      chosen = result.manifest;
    }
  }
  if (chosen === null) {
    return { manifest: null, errors: [...incompatible, ...malformed, ...structural] };
  }
  return { manifest: chosen, errors: [...malformed, ...structural] };
}

/**
 * Validates an untrusted value as an index document.
 *
 * One bad entry does not spoil the document — it is reported and skipped, exactly as a broken plugin in
 * the sideload directory costs the user that plugin and nothing else. A bad *envelope* is a different
 * matter and is refused outright: if the thing is not shaped like an index, nothing in it can be
 * trusted to be shaped like a plugin either.
 *
 * Each entry may offer several releases (see {@link pluginReleaseCandidates}); the one in force is the
 * newest this build can run (see {@link selectPluginRelease}). An entry is refused only when it offers
 * none this build can run.
 * @param value The parsed JSON to validate.
 * @param supported The plugin API this build implements.
 * @returns Returns the document, or null when the envelope is not one.
 */
export function parsePluginIndex(
  value: unknown,
  supported: string = PLUGIN_API_VERSION,
): PluginIndexDocument | null {
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
  const refused: string[] = [];
  const seen: Set<string> = new Set<string>();
  source.plugins.forEach((entry: unknown, index: number): void => {
    const result: PluginReleaseSelection = selectPluginRelease(entry, index, supported);
    errors.push(...result.errors);
    if (result.manifest === null) {
      const id: string | null = claimedId(entry);
      if (id !== null) {
        refused.push(id);
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
  return { revision: source.revision, manifests, errors, refused };
}

/**
 * Lays a newer index over the one this build shipped with.
 *
 * The newer copy wins, entry by entry, except where it names a plugin this build cannot honour. That is
 * most often a plugin released against a newer plugin API than this build implements, where the newer
 * entry lists no older release this build could run instead. Dropping the entry would take the plugin
 * away from a build that was installing it yesterday (beta.10 lost GitHub this way), so the seed's own
 * entry stands instead: an older release, but one this build can run.
 *
 * Where the newer entry does list a release this build can run, that release is used, even when it is
 * older than the seed's: the published copy is the curated one, and withdrawing a bad release from it
 * has to reach the builds that shipped with it.
 * @param newer The newer copy.
 * @param seed The copy this build shipped with.
 * @returns Returns the document in force.
 */
export function overlayPluginIndex(
  newer: PluginIndexDocument,
  seed: PluginIndexDocument,
): PluginIndexDocument {
  const present: Set<string> = new Set<string>(
    newer.manifests.map((manifest: PluginManifest): string => manifest.id),
  );
  const kept: readonly PluginManifest[] = seed.manifests.filter(
    (manifest: PluginManifest): boolean =>
      newer.refused.includes(manifest.id) && !present.has(manifest.id),
  );
  return kept.length === 0 ? newer : { ...newer, manifests: [...newer.manifests, ...kept] };
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
      refused: [],
    };
    const cached: PluginIndexDocument | null = this.readCache();
    if (cached === null || cached.revision <= seed.revision) {
      logger.info(
        'PluginIndex',
        `Using bundled index revision ${seed.revision} (${seed.manifests.length} plugins)`,
      );
      return seed;
    }
    const resolved: PluginIndexDocument = overlayPluginIndex(cached, seed);
    for (const manifest of resolved.manifests.slice(cached.manifests.length)) {
      logger.info(
        'PluginIndex',
        `Keeping the bundled ${manifest.id} ${manifest.version}: this build cannot honour the newer entry`,
      );
    }
    logger.info(
      'PluginIndex',
      `Using cached index revision ${cached.revision} (${resolved.manifests.length} plugins)`,
    );
    return resolved;
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
