import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  PackageCommand,
  PackageManagerCapability,
  PackageManagerDescription,
  PackageManagerOp,
  PackageManagerParams,
  PackageManagerResponse,
  PM_OP_CAPABILITY,
  PM_READ_OPS,
  PM_WRITE_OPS,
} from '@shared/api/package-manager-protocol';
import type { PackageSearchResult, PackageSourceInfo } from '@shared/api/package-management';
import type { RepositoryTrustDecision } from '@shared/api/source-control-channels';
import { logger } from '../logger';
import { PackageManagerClient, PackageManagerCredentialSource } from './package-manager-client';
import {
  PackageManagerDescriptor,
  PackageManagerResolution,
  PackageManagerSpec,
} from './package-manager-descriptor';
import { PackageManagerEndpoint } from './package-manager-endpoint';

/**
 * Specifies how long an ordinary request may take.
 */
const REQUEST_TIMEOUT_MS: number = 60_000;

/**
 * Specifies how long reading a folder may take: it asks a registry about every distinct package, and a
 * large monorepo on a slow connection is hundreds of them.
 */
const LOAD_TIMEOUT_MS: number = 5 * 60_000;

/**
 * Specifies how many levels below a folder the marker scan looks. A project sits at or near the root of
 * what is open; deeper than this the walk costs more than it finds.
 */
const MARKER_SCAN_DEPTH: number = 3;

/**
 * Specifies how many directories one marker scan reads, so a huge unignored tree costs a bounded walk.
 */
const MARKER_SCAN_DIRECTORIES: number = 2_000;

/**
 * Specifies the directories the marker scan never enters: what tools generate, where a marker found
 * would be a dependency's and not a project of the user's. Hidden directories are skipped as well.
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  'node_modules',
  'bin',
  'obj',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
]);

/**
 * Specifies the largest page of search results a request may ask for.
 */
const MAX_SEARCH_PAGE: number = 100;

/**
 * Specifies the page size when a request asks for none.
 */
const DEFAULT_SEARCH_PAGE: number = 50;

/**
 * The part of the open-workspace registry a request's folder is checked against.
 */
export interface PackageManagerRoots {
  /**
   * Determines whether a path is an open workspace root or lies inside one.
   * @param target The path to test.
   * @returns Returns true when the path is within an open workspace root.
   */
  isWithin(target: unknown): boolean;
}

/**
 * The part of the repository-trust store a request's folder is checked against.
 */
export interface PackageManagerTrustSource {
  /**
   * Gets what the user decided about a folder, or `unknown` when they have not been asked.
   * @param target The folder to test.
   * @returns Returns the decision in force for the folder.
   */
  decisionFor(target: unknown): RepositoryTrustDecision;
}

/**
 * Describes one entry the marker scan sees in a directory.
 */
export interface PackageManagerDirectoryEntry {
  /**
   * Gets the entry's name.
   */
  readonly name: string;

  /**
   * Gets whether the entry is a directory.
   */
  readonly directory: boolean;
}

/**
 * Describes what the host depends on, injectable so it is testable without processes or a disk.
 */
export interface PackageManagerHostOptions {
  /**
   * Gets the contributed package-manager plugins, read afresh each time so an install or uninstall is
   * seen without a restart.
   */
  readonly descriptors: () => readonly PackageManagerDescriptor[];

  /**
   * Gets the open workspace roots every folder must lie within.
   */
  readonly roots: PackageManagerRoots;

  /**
   * Gets whether the user trusts each folder's contents. A plugin runs in a folder only once the user
   * has said so: a project's own configuration can name a registry to talk to and scripts to run.
   */
  readonly trust: PackageManagerTrustSource;

  /**
   * Reads a token the user saved in Studio for a plugin and a registry, or null when there is none.
   * ⛔ Keyed by both, so a token saved for one plugin is never handed to another.
   */
  readonly credential: (pluginId: string, registry: string) => Promise<string | null>;

  /**
   * Lists a directory for the marker scan. Defaults to the filesystem.
   */
  readonly listDirectory?: (directory: string) => Promise<readonly PackageManagerDirectoryEntry[]>;

  /**
   * Creates the client for a plugin's process. Defaults to a real process.
   */
  readonly createClient?: (
    id: string,
    spec: PackageManagerSpec,
    credentials: PackageManagerCredentialSource,
  ) => PackageManagerEndpoint;
}

/**
 * Describes a running plugin and what it may be asked.
 */
interface RunningPlugin {
  /**
   * Gets the endpoint answering for the plugin.
   */
  readonly client: PackageManagerEndpoint;

  /**
   * Gets the capabilities both the manifest declared and the handshake confirmed.
   */
  readonly capabilities: readonly PackageManagerCapability[];

  /**
   * Gets what the plugin said it is.
   */
  readonly description: PackageManagerDescription;
}

/**
 * Describes what a plugin can do, or why it cannot be asked.
 */
export type PackageManagerPluginDescription =
  | {
      readonly ok: true;
      readonly pluginId: string;
      readonly description: PackageManagerDescription;
      readonly capabilities: readonly PackageManagerCapability[];
    }
  | { readonly ok: false; readonly error: string };

/**
 * Hosts the package-manager plugins in the main process (#908): finds which ones apply to a folder,
 * starts each on first use, and stands between it and an untrusted renderer.
 *
 * Several plugins can apply to one folder, so unlike the version-control host this one never picks: a
 * repository can hold a .NET solution and an npm package side by side, and each request names the
 * plugin it is for.
 *
 * ⛔ Every check lives here rather than in the plugin, because a plugin is code Studio did not write:
 * - a request's folder must be absolute and lie within an open workspace root, and any project it
 *   names must lie within that folder;
 * - the user must have said they trust the folder, because its configuration decides what a plugin's
 *   tool talks to and runs;
 * - a request needing a capability the plugin did not both declare and confirm is refused without the
 *   plugin ever seeing it, and a search is cut down to what the plugin can do;
 * - a command a plugin answers with is run by Studio, so it must be well formed and stay inside the
 *   folder, or it is refused;
 * - a plugin is handed only a token saved for it, and only for an https registry;
 * - what reaches the renderer about a source is its name, whatever else the plugin sent;
 * - identical concurrent reads are answered by one request.
 */
export class PackageManagerHost {
  /**
   * Holds the dependencies.
   */
  private readonly options: PackageManagerHostOptions;

  /**
   * Holds the running plugins, keyed by plugin id.
   */
  private readonly running: Map<string, RunningPlugin> = new Map<string, RunningPlugin>();

  /**
   * Holds the starts in progress, keyed by plugin id, so two first requests start one process.
   */
  private readonly starting: Map<string, Promise<RunningPlugin | string>> = new Map<
    string,
    Promise<RunningPlugin | string>
  >();

  /**
   * Holds how many times each plugin has been restarted, so a start already under way when it was
   * restarted is recognised as stale when it finishes and does not bring the old process back (#881).
   */
  private readonly generations: Map<string, number> = new Map<string, number>();

  /**
   * Holds the reads in flight, keyed by plugin, folder, operation and parameters.
   */
  private readonly inFlightReads: Map<string, Promise<PackageManagerResponse>> = new Map<
    string,
    Promise<PackageManagerResponse>
  >();

  /**
   * Initializes the host.
   * @param options What the host depends on.
   */
  public constructor(options: PackageManagerHostOptions) {
    this.options = options;
  }

  /**
   * Finds every plugin a folder applies to — whose marker the folder holds, or a directory shallowly
   * under it — installed or not, so a surface can offer the install. Confined to the open workspace
   * roots: an answer reveals whether a file exists, which is not the renderer's to ask anywhere on disk.
   * @param root The absolute folder.
   * @returns Returns the plugins, highest priority first; empty when none applies or it is not open.
   */
  public async detect(root: unknown): Promise<readonly PackageManagerDescriptor[]> {
    if (this.refuseRoot(root) !== null) {
      return [];
    }
    const names: ReadonlySet<string> = await this.scan(path.resolve(root as string));
    return this.preferredOrder().filter((descriptor: PackageManagerDescriptor): boolean =>
      descriptor.markers.some((marker: string): boolean => {
        const pattern: RegExp = markerPattern(marker);
        return [...names].some((name: string): boolean => pattern.test(name));
      }),
    );
  }

  /**
   * Finds the installed plugins a folder applies to: the ones that can be asked about it.
   * @param root The absolute folder.
   * @returns Returns the plugins, highest priority first.
   */
  public async pluginsFor(root: unknown): Promise<readonly PackageManagerDescriptor[]> {
    // Nothing installed is the usual case for now, and needs no walk of the folder to answer.
    const installed: boolean = this.options
      .descriptors()
      .some((descriptor: PackageManagerDescriptor): boolean => descriptor.resolve().available);
    if (!installed) {
      return [];
    }
    return (await this.detect(root)).filter(
      (descriptor: PackageManagerDescriptor): boolean => descriptor.resolve().available,
    );
  }

  /**
   * Gets every contributed plugin, highest priority first.
   * @returns Returns the descriptors.
   */
  public preferredOrder(): readonly PackageManagerDescriptor[] {
    return [...this.options.descriptors()].sort(
      (a: PackageManagerDescriptor, b: PackageManagerDescriptor): number => b.priority - a.priority,
    );
  }

  /**
   * Determines whether a request may run in a folder, without asking any plugin.
   * @param root The candidate folder.
   * @returns Returns true when the folder is open and the user trusts it.
   */
  public accepts(root: unknown): boolean {
    return this.refuseRoot(root) === null && this.refuseUntrusted(root as string) === null;
  }

  /**
   * Gets what a named plugin can do, starting it if it is not running.
   * @param pluginId The plugin.
   * @returns Returns the confirmed capabilities and description, or the reason there are none.
   */
  public async describePlugin(pluginId: string): Promise<PackageManagerPluginDescription> {
    const descriptor: PackageManagerDescriptor | undefined = this.descriptor(pluginId);
    if (descriptor === undefined) {
      return { ok: false, error: `No package-manager plugin named ${pluginId} is installed.` };
    }
    const plugin: RunningPlugin | string = await this.ensure(descriptor);
    return typeof plugin === 'string'
      ? { ok: false, error: plugin }
      : {
          ok: true,
          pluginId: descriptor.id,
          description: plugin.description,
          capabilities: plugin.capabilities,
        };
  }

  /**
   * Asks a plugin to perform an operation on a folder.
   * @param pluginId The plugin to ask.
   * @param root The absolute folder, which must lie within an open workspace root.
   * @param op The operation.
   * @param params The operation's parameters.
   * @returns Returns the plugin's answer, or the host's refusal.
   */
  public async request<Op extends PackageManagerOp>(
    pluginId: string,
    root: unknown,
    op: Op,
    params: PackageManagerParams<Op>,
  ): Promise<PackageManagerResponse<Op>> {
    if (op === 'initialize') {
      return refused(`${op} does not act on a folder.`);
    }
    const refusal: string | null = this.refuseRoot(root);
    if (refusal !== null) {
      return refused(refusal);
    }
    const resolvedRoot: string = path.resolve(root as string);
    const distrust: string | null = this.refuseUntrusted(resolvedRoot);
    if (distrust !== null) {
      return { id: 0, ok: false, error: distrust, code: 'untrusted' };
    }
    if (PM_WRITE_OPS.includes(op) && !isInside(projectOf(params), resolvedRoot)) {
      return refused('That project is not in this folder.');
    }
    const descriptor: PackageManagerDescriptor | undefined = this.descriptor(pluginId);
    if (descriptor === undefined) {
      return refused(`No package-manager plugin named ${pluginId} is installed.`);
    }
    return this.dispatch(descriptor, resolvedRoot, op, params);
  }

  /**
   * Gets a contributed plugin by id.
   * @param pluginId The plugin.
   * @returns Returns the descriptor, or undefined when no such plugin is contributed.
   */
  public descriptor(pluginId: string): PackageManagerDescriptor | undefined {
    return this.options
      .descriptors()
      .find((candidate: PackageManagerDescriptor): boolean => candidate.id === pluginId);
  }

  /**
   * Stops a plugin, so the next request starts it afresh — after it was updated or removed (#881).
   * @param pluginId The plugin.
   */
  public restartPlugin(pluginId: string): void {
    this.generations.set(pluginId, (this.generations.get(pluginId) ?? 0) + 1);
    this.running.get(pluginId)?.client.dispose();
    this.running.delete(pluginId);
    this.starting.delete(pluginId);
  }

  /**
   * Stops every running plugin.
   */
  public dispose(): void {
    for (const plugin of this.running.values()) {
      plugin.client.dispose();
    }
    this.running.clear();
    this.starting.clear();
    this.inFlightReads.clear();
  }

  /**
   * Checks the capability, shares an identical read in flight, and sends the request.
   * @param descriptor The plugin to ask.
   * @param root The folder.
   * @param op The operation.
   * @param params The operation's parameters.
   * @returns Returns the plugin's answer, or the host's refusal.
   */
  private async dispatch<Op extends PackageManagerOp>(
    descriptor: PackageManagerDescriptor,
    root: string,
    op: Op,
    params: PackageManagerParams<Op>,
  ): Promise<PackageManagerResponse<Op>> {
    const plugin: RunningPlugin | string = await this.ensure(descriptor);
    if (typeof plugin === 'string') {
      return { id: 0, ok: false, error: plugin };
    }
    const needed: PackageManagerCapability | undefined = PM_OP_CAPABILITY[op];
    if (needed !== undefined && !plugin.capabilities.includes(needed)) {
      return {
        id: 0,
        ok: false,
        error: `${descriptor.displayName} does not support this (${needed}).`,
        code: 'unsupported',
      };
    }
    const asked: PackageManagerParams<Op> =
      op === 'search' ? narrowSearch(params, plugin.capabilities) : params;
    if (
      op === 'search' &&
      plugin.capabilities.includes('searchRequiresQuery') &&
      (asked as PackageManagerParams<'search'>).query.trim().length === 0
    ) {
      const nothing: PackageSearchResult = { items: [], total: 0, hasMore: false };
      return { id: 0, ok: true, result: nothing };
    }
    const timeoutMs: number = op === 'load' ? LOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
    if (!PM_READ_OPS.includes(op)) {
      return checkCommand(await plugin.client.request(op, root, asked, timeoutMs), root);
    }
    const key: string = JSON.stringify([descriptor.id, root, op, asked]);
    const existing: Promise<PackageManagerResponse> | undefined = this.inFlightReads.get(key);
    if (existing !== undefined) {
      logger.trace('PackageManagerHost', `Shared a concurrent ${op}`);
      return existing;
    }
    const answer: Promise<PackageManagerResponse<Op>> = plugin.client
      .request(op, root, asked, timeoutMs)
      .then((response: PackageManagerResponse<Op>): PackageManagerResponse<Op> =>
        op === 'sources' ? sourcesNamesOnly(response) : response,
      );
    this.inFlightReads.set(key, answer);
    try {
      return await answer;
    } finally {
      this.inFlightReads.delete(key);
    }
  }

  /**
   * Gets a plugin's running instance, starting it when it is not running (or has exited).
   * @param descriptor The plugin.
   * @returns Returns the running plugin, or the reason it could not be started.
   */
  private ensure(descriptor: PackageManagerDescriptor): Promise<RunningPlugin | string> {
    const current: RunningPlugin | undefined = this.running.get(descriptor.id);
    if (current?.client.running === true) {
      // ⛔ Still installed, or nothing is served. A running process outlives its files, so being
      // alive is not the same as being installed (#881).
      if (descriptor.resolve().available) {
        return Promise.resolve(current);
      }
      logger.info(
        'PackageManagerHost',
        `${descriptor.id} is no longer installed; stopping its process`,
      );
      this.restartPlugin(descriptor.id);
    }
    this.running.delete(descriptor.id);
    const inProgress: Promise<RunningPlugin | string> | undefined = this.starting.get(
      descriptor.id,
    );
    if (inProgress !== undefined) {
      return inProgress;
    }
    const started: Promise<RunningPlugin | string> = this.start(descriptor).finally((): void => {
      // Only this start's own entry: a restart while it ran may already have a newer one in place.
      if (this.starting.get(descriptor.id) === started) {
        this.starting.delete(descriptor.id);
      }
    });
    this.starting.set(descriptor.id, started);
    return started;
  }

  /**
   * Starts a plugin and records what it may be asked: the capabilities the manifest declared *and* the
   * handshake confirmed. A manifest is a promise; the handshake is the plugin itself answering.
   * @param descriptor The plugin.
   * @returns Returns the running plugin, or the reason it could not be started.
   */
  private async start(descriptor: PackageManagerDescriptor): Promise<RunningPlugin | string> {
    const generation: number = this.generations.get(descriptor.id) ?? 0;
    const resolution: PackageManagerResolution = descriptor.resolve();
    if (!resolution.available) {
      return resolution.reason;
    }
    const credentials: PackageManagerCredentialSource = (
      registry: string,
    ): Promise<string | null> => this.credentialFor(descriptor, registry);
    const client: PackageManagerEndpoint =
      this.options.createClient?.(descriptor.id, resolution.spec, credentials) ??
      new PackageManagerClient(descriptor.id, resolution.spec, credentials);
    const description: PackageManagerDescription | null = await client.start();
    if (description === null) {
      return `${descriptor.displayName} could not be started.`;
    }
    if ((this.generations.get(descriptor.id) ?? 0) !== generation) {
      // Restarted while this one started — updated or removed underneath it. What it started is
      // stale, so it is stopped and whatever is installed now is started instead.
      logger.info(
        'PackageManagerHost',
        `${descriptor.id} changed while starting; starting it afresh`,
      );
      client.dispose();
      return this.ensure(descriptor);
    }
    const plugin: RunningPlugin = {
      client,
      description,
      capabilities: description.capabilities.filter((capability: PackageManagerCapability) =>
        descriptor.capabilities.includes(capability),
      ),
    };
    this.running.set(descriptor.id, plugin);
    return plugin;
  }

  /**
   * Answers a plugin's request for a registry's credential: a token the user saved for this plugin and
   * this registry, and only over https, since the plugin will send it there.
   * @param descriptor The plugin asking.
   * @param registry The registry it named.
   * @returns Returns the credential, or null when it is not the plugin's to have.
   */
  private credentialFor(
    descriptor: PackageManagerDescriptor,
    registry: string,
  ): Promise<string | null> {
    const normalised: string | null = normaliseRegistry(registry);
    if (normalised === null) {
      logger.warn(
        'PackageManagerHost',
        `'${descriptor.id}' asked for a credential for something that is not an https registry; refused`,
      );
      return Promise.resolve(null);
    }
    return this.options.credential(descriptor.id, normalised);
  }

  /**
   * Walks a folder for the file names the marker scan can see.
   * @param root The absolute folder.
   * @returns Returns the distinct file names found within {@link MARKER_SCAN_DEPTH} levels.
   */
  private async scan(root: string): Promise<ReadonlySet<string>> {
    const list: (directory: string) => Promise<readonly PackageManagerDirectoryEntry[]> =
      this.options.listDirectory ?? listDirectory;
    const names: Set<string> = new Set<string>();
    let level: readonly string[] = [root];
    let read: number = 0;
    for (let depth: number = 0; depth <= MARKER_SCAN_DEPTH && level.length > 0; depth += 1) {
      const next: string[] = [];
      for (const directory of level) {
        if (read >= MARKER_SCAN_DIRECTORIES) {
          return names;
        }
        read += 1;
        for (const entry of await list(directory)) {
          if (!entry.directory) {
            names.add(entry.name);
          } else if (!entry.name.startsWith('.') && !SKIPPED_DIRECTORIES.has(entry.name)) {
            next.push(path.join(directory, entry.name));
          }
        }
      }
      level = next;
    }
    return names;
  }

  /**
   * Checks a folder a request names: it must be absolute and lie within an open workspace root.
   * @param target The candidate folder.
   * @returns Returns the reason it is refused, or null when it is acceptable.
   */
  private refuseRoot(target: unknown): string | null {
    if (typeof target !== 'string' || !path.isAbsolute(target)) {
      return 'The path is not absolute.';
    }
    return this.options.roots.isWithin(path.resolve(target))
      ? null
      : 'That folder is not an open workspace.';
  }

  /**
   * Checks that the user trusts the folder a request names. Asked after {@link refuseRoot}, so the path
   * is already absolute and open.
   * @param target The folder.
   * @returns Returns the reason it is refused, or null when the folder is trusted.
   */
  private refuseUntrusted(target: string): string | null {
    const decision: RepositoryTrustDecision = this.options.trust.decisionFor(target);
    if (decision === 'trusted') {
      return null;
    }
    logger.debug('PackageManagerHost', `Refused a request in ${decision} folder ${target}`);
    return decision === 'restricted'
      ? 'This folder is not trusted, so package managers are not run in it.'
      : 'This folder has not been trusted yet, so package managers are not run in it.';
  }
}

/**
 * Builds the host's refusal of a request it would not send.
 * @param error The reason.
 * @returns Returns the failure.
 */
function refused<Op extends PackageManagerOp>(error: string): PackageManagerResponse<Op> {
  return { id: 0, ok: false, error, code: 'refused' };
}

/**
 * Turns a marker into a pattern for one file name: `*` matches within the name, and everything else
 * stands for itself.
 * @param marker The marker.
 * @returns Returns the pattern.
 */
function markerPattern(marker: string): RegExp {
  const parts: readonly string[] = marker
    .split('*')
    .map((part: string): string => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${parts.join('.*')}$`);
}

/**
 * Lists a directory, tolerating one that cannot be read.
 * @param directory The directory.
 * @returns Returns its entries, or none when it cannot be read.
 */
async function listDirectory(directory: string): Promise<readonly PackageManagerDirectoryEntry[]> {
  try {
    const entries: import('node:fs').Dirent[] = await fs.readdir(directory, {
      withFileTypes: true,
    });
    return entries.map((entry: import('node:fs').Dirent): PackageManagerDirectoryEntry => ({
      name: entry.name,
      directory: entry.isDirectory(),
    }));
  } catch {
    return [];
  }
}

/**
 * Determines whether a path lies within a folder.
 * @param target The candidate path.
 * @param root The absolute folder.
 * @returns Returns true when it is an absolute path inside the folder, or the folder itself.
 */
function isInside(target: unknown, root: string): boolean {
  if (typeof target !== 'string' || !path.isAbsolute(target)) {
    return false;
  }
  const resolved: string = path.resolve(target);
  return resolved === root || resolved.startsWith(root + path.sep);
}

/**
 * Reads the project a write request names.
 * @param params The request's parameters.
 * @returns Returns the project, undefined when there is none.
 */
function projectOf(params: unknown): unknown {
  return typeof params === 'object' && params !== null
    ? (params as Record<string, unknown>)['project']
    : undefined;
}

/**
 * Cuts a search down to what is safe and what the plugin can do: a bounded page, whatever the renderer
 * asked for, and prerelease versions only from a plugin that can filter by them.
 * @param params The search as asked.
 * @param capabilities The plugin's capabilities.
 * @returns Returns the search to send.
 */
function narrowSearch(
  params: unknown,
  capabilities: readonly PackageManagerCapability[],
): PackageManagerParams<'search'> {
  const record: Record<string, unknown> =
    typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {};
  const skip: unknown = record['skip'];
  const take: unknown = record['take'];
  const source: unknown = record['source'];
  const query: unknown = record['query'];
  return {
    source: typeof source === 'string' ? source : '',
    query: typeof query === 'string' ? query : '',
    skip: typeof skip === 'number' && Number.isFinite(skip) && skip > 0 ? Math.floor(skip) : 0,
    take:
      typeof take === 'number' && Number.isFinite(take) && take >= 1
        ? Math.min(Math.floor(take), MAX_SEARCH_PAGE)
        : DEFAULT_SEARCH_PAGE,
    prerelease: record['prerelease'] === true && capabilities.includes('prerelease'),
  };
}

/**
 * Reduces a `sources` answer to the names. ⛔ This goes to the renderer, and a source's URL can carry a
 * user and password, so whatever else a plugin sent stops here.
 * @param response The plugin's answer.
 * @returns Returns the answer with names only.
 */
function sourcesNamesOnly<Op extends PackageManagerOp>(
  response: PackageManagerResponse<Op>,
): PackageManagerResponse<Op> {
  if (!response.ok) {
    return response;
  }
  const sources: unknown = (response.result as { sources?: unknown } | null)?.sources;
  const names: readonly PackageSourceInfo[] = Array.isArray(sources)
    ? sources
        .map((source: unknown): unknown => (source as { name?: unknown } | null)?.name)
        .filter((name: unknown): name is string => typeof name === 'string' && name.length > 0)
        .map((name: string): PackageSourceInfo => ({ name }))
    : [];
  return { ...response, result: { sources: names } };
}

/**
 * Checks a command a plugin answered a write with. ⛔ Studio runs what comes back in a terminal, so a
 * malformed one, or one that would run outside the folder the request named, goes no further.
 * @param response The plugin's answer.
 * @param root The folder the request named.
 * @returns Returns the answer, or a refusal.
 */
function checkCommand<Op extends PackageManagerOp>(
  response: PackageManagerResponse<Op>,
  root: string,
): PackageManagerResponse<Op> {
  if (!response.ok) {
    return response;
  }
  const command: Partial<PackageCommand> | null = response.result as Partial<PackageCommand> | null;
  const wellFormed: boolean =
    typeof command?.executable === 'string' &&
    command.executable.length > 0 &&
    typeof command.title === 'string' &&
    Array.isArray(command.args) &&
    command.args.every((arg: unknown): boolean => typeof arg === 'string') &&
    isInside(command.cwd, root);
  if (wellFormed) {
    return response;
  }
  logger.warn('PackageManagerHost', 'A plugin answered a write with a command it may not run');
  return refused('The plugin answered with a command Studio will not run.');
}

/**
 * Normalises a registry a plugin named: an https URL, without credentials, query or fragment, and
 * without a trailing slash, so one registry is one key however it was written.
 * @param registry The registry.
 * @returns Returns the normalised URL, or null when it is not an https URL.
 */
function normaliseRegistry(registry: string): string | null {
  let url: URL;
  try {
    url = new URL(registry);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username.length > 0 || url.password.length > 0) {
    return null;
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}
