import { existsSync } from 'node:fs';
import * as path from 'node:path';
import {
  VCS_GLOBAL_OPS,
  VCS_NETWORK_OPS,
  VCS_OP_CAPABILITY,
  VCS_READ_OPS,
  VersionControlCapability,
  VersionControlDescription,
  VersionControlExecutableChoice,
  VersionControlOp,
  VersionControlResponse,
  VcsParams,
} from '@shared/api/version-control-protocol';
import { logger } from '../logger';
import { VersionControlClient } from './version-control-client';
import { VersionControlEndpoint } from './version-control-endpoint';
import {
  VersionControlDescriptor,
  VersionControlResolution,
  VersionControlSpec,
} from './version-control-descriptor';

/**
 * Specifies how long an ordinary request may take. Generous because a status on a very large working
 * tree is a full filesystem crawl, but bounded so a wedged plugin costs one failed operation.
 */
const REQUEST_TIMEOUT_MS: number = 60_000;

/**
 * Specifies how long a request that reaches another machine may take — a clone of a large repository
 * over a slow connection.
 */
const NETWORK_TIMEOUT_MS: number = 15 * 60_000;

/**
 * Specifies how long computed metadata policies are reused before being recomputed.
 */
const POLICY_CACHE_MS: number = 2_000;

/**
 * The part of the open-workspace registry a request's paths are checked against.
 */
export interface VersionControlRoots {
  /**
   * Determines whether a path is an open workspace root or lies inside one.
   * @param target The path to test.
   * @returns Returns true when the path is within an open workspace root.
   */
  isWithin(target: unknown): boolean;
}

/**
 * Describes a running plugin and what it may be asked.
 */
interface RunningPlugin {
  /**
   * Gets the endpoint answering for the plugin.
   */
  readonly client: VersionControlEndpoint;

  /**
   * Gets the capabilities both the manifest declared and the handshake confirmed.
   */
  readonly capabilities: readonly VersionControlCapability[];

  /**
   * Gets what the plugin said it is.
   */
  readonly description: VersionControlDescription;
}

/**
 * Describes what the host depends on, injectable so it is testable without processes or a disk.
 */
export interface VersionControlHostOptions {
  /**
   * Gets the contributed version-control plugins, read afresh each time so an install or uninstall is
   * seen without a restart.
   */
  readonly descriptors: () => readonly VersionControlDescriptor[];

  /**
   * Gets the open workspace roots every repository path must lie within.
   */
  readonly roots: VersionControlRoots;

  /**
   * Gets the user's choice of which tool a plugin runs, or null for the plugin's default.
   */
  readonly executableFor: (pluginId: string) => VersionControlExecutableChoice | null;

  /**
   * Determines whether a path exists. Defaults to the filesystem.
   */
  readonly exists?: (target: string) => boolean;

  /**
   * Creates the client for a plugin's process. Defaults to a real process.
   */
  readonly createClient?: (id: string, spec: VersionControlSpec) => VersionControlEndpoint;
}

/**
 * Describes what a plugin can do, or why it cannot be asked.
 */
export type PluginDescription =
  | {
      readonly ok: true;
      readonly pluginId: string;
      readonly description: VersionControlDescription;
      readonly capabilities: readonly VersionControlCapability[];
    }
  | { readonly ok: false; readonly error: string };

/**
 * Describes a repository the host has opened.
 */
export interface OpenedRepository {
  /**
   * Gets the repository's absolute root.
   */
  readonly root: string;

  /**
   * Gets the repository's folder name.
   */
  readonly name: string;

  /**
   * Gets the plugin serving it.
   */
  readonly pluginId: string;
}

/**
 * Hosts the version-control plugins in the main process (#815): finds which one serves a repository,
 * starts it on first use, and stands between it and an untrusted renderer.
 *
 * ⛔ Every check lives here rather than in the plugin, because a plugin is code Studio did not write:
 * - a request's root must be absolute and lie within an open repository or an open workspace root.
 *   A repository is opened by {@link openRepository} and reference-counted, because several surfaces
 *   (a repository tab and a workspace tab) can open the same one independently — the registry
 *   `GitManager` kept until #816;
 * - a request needing a capability the plugin did not both declare and confirm is refused without the
 *   plugin ever seeing it;
 * - identical concurrent reads are answered by one request.
 */
export class VersionControlHost {
  /**
   * Holds the dependencies.
   */
  private readonly options: VersionControlHostOptions;

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
   * Holds the reads in flight, keyed by plugin, root, operation and parameters.
   */
  private readonly inFlightReads: Map<string, Promise<VersionControlResponse>> = new Map<
    string,
    Promise<VersionControlResponse>
  >();

  /**
   * Holds the most recent metadata policies and when they were computed.
   */
  private policies: { at: number; value: ReadonlyMap<string, readonly string[]> } | null = null;

  /**
   * Holds the open repository roots, each with an open count.
   */
  private readonly repositories: Map<string, number> = new Map<string, number>();

  /**
   * Initializes the host.
   * @param options What the host depends on.
   */
  public constructor(options: VersionControlHostOptions) {
    this.options = options;
  }

  /**
   * Finds the plugin serving a repository root: among those whose marker the root holds, the highest
   * priority.
   * @param root The absolute repository root.
   * @returns Returns the plugin, or null when no installed plugin recognises the root.
   */
  public pluginFor(root: string): VersionControlDescriptor | null {
    const exists: (target: string) => boolean = this.options.exists ?? existsSync;
    const candidates: VersionControlDescriptor[] = this.options
      .descriptors()
      .filter((descriptor: VersionControlDescriptor): boolean =>
        descriptor.markers.some((marker: string): boolean => exists(path.join(root, marker))),
      );
    candidates.sort(
      (a: VersionControlDescriptor, b: VersionControlDescriptor): number => b.priority - a.priority,
    );
    return candidates[0] ?? null;
  }

  /**
   * Gets the plugin to ask when there is no repository to recognise yet (a clone with no existing
   * checkout, the setup wizard): the highest-priority installed one, else the highest-priority one the
   * index offers — whose answer then says it is not installed.
   * @returns Returns the plugin, or null when none is contributed at all.
   */
  public preferredPlugin(): VersionControlDescriptor | null {
    const order: readonly VersionControlDescriptor[] = this.preferredOrder();
    return (
      order.find(
        (descriptor: VersionControlDescriptor): boolean => descriptor.resolve().available,
      ) ??
      order[0] ??
      null
    );
  }

  /**
   * Gets every contributed plugin, highest priority first.
   * @returns Returns the descriptors.
   */
  public preferredOrder(): readonly VersionControlDescriptor[] {
    return [...this.options.descriptors()].sort(
      (a: VersionControlDescriptor, b: VersionControlDescriptor): number => b.priority - a.priority,
    );
  }

  /**
   * Finds the plugin a folder belongs to — whose marker the folder or one of its ancestors holds —
   * whether or not that plugin is installed. Confined to the open workspace roots: an answer reveals
   * whether a marker exists, which is not the renderer's to ask about anywhere on disk.
   * @param directory The absolute folder.
   * @returns Returns the plugin, or null when none recognises the folder or it is not open.
   */
  public detect(directory: unknown): VersionControlDescriptor | null {
    if (
      typeof directory !== 'string' ||
      !path.isAbsolute(directory) ||
      !this.options.roots.isWithin(directory)
    ) {
      return null;
    }
    let candidate: string = path.resolve(directory);
    let descriptor: VersionControlDescriptor | null = this.pluginFor(candidate);
    while (descriptor === null && path.dirname(candidate) !== candidate) {
      candidate = path.dirname(candidate);
      descriptor = this.pluginFor(candidate);
    }
    return descriptor;
  }

  /**
   * Opens the repository containing a folder: finds the plugin whose marker the folder or one of its
   * ancestors holds, asks it for the repository's exact root, and registers that root so requests may
   * act on it. Reference-counted; each open is matched by a {@link closeRepository}.
   *
   * The folder is trusted only as a starting point, exactly as `GitManager.resolveRepository` was: the
   * user chose it (a dialog, a workspace, a restored tab), and the plugin's answer — not the folder —
   * becomes the confined root.
   * @param directory The absolute folder to start from.
   * @returns Returns the repository, or null when the folder is in none an installed plugin knows.
   */
  public async openRepository(directory: unknown): Promise<OpenedRepository | null> {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
      return null;
    }
    const start: string = path.resolve(directory);
    let candidate: string = start;
    let descriptor: VersionControlDescriptor | null = this.pluginFor(candidate);
    while (descriptor === null && path.dirname(candidate) !== candidate) {
      candidate = path.dirname(candidate);
      descriptor = this.pluginFor(candidate);
    }
    if (descriptor === null) {
      logger.trace('VersionControlHost.openRepository', `No repository contains ${start}`);
      return null;
    }
    const resolved: VersionControlResponse<'resolveRoot'> = await this.dispatch(
      descriptor,
      undefined,
      'resolveRoot',
      { path: start },
    );
    if (!resolved.ok || resolved.result.root === null) {
      return null;
    }
    const root: string = path.resolve(resolved.result.root);
    const count: number = (this.repositories.get(root) ?? 0) + 1;
    this.repositories.set(root, count);
    logger.info('VersionControlHost', `Opened repository ${root} (open count ${count})`);
    return { root, name: path.basename(root), pluginId: descriptor.id };
  }

  /**
   * Releases an open repository, removing it once the last surface using it has released it.
   * @param root The repository root.
   */
  public closeRepository(root: unknown): void {
    if (typeof root !== 'string') {
      return;
    }
    const resolved: string = path.resolve(root);
    const count: number | undefined = this.repositories.get(resolved);
    if (count === undefined) {
      return;
    }
    if (count <= 1) {
      this.repositories.delete(resolved);
      logger.info('VersionControlHost', `Closed repository ${resolved}`);
    } else {
      this.repositories.set(resolved, count - 1);
    }
  }

  /**
   * Gets the version-control systems' own directory names across every contributed plugin, for the
   * directory watcher and write confinement.
   * @returns Returns the distinct names.
   */
  public metadataDirectories(): readonly string[] {
    return [...this.metadataPolicies().keys()];
  }

  /**
   * Gets, per metadata directory name, the patterns whose changes are worth forwarding — what the
   * directory watcher filters a repository's own bookkeeping by. Every contributed plugin counts,
   * installed or not, so the policy is known before the first repository is opened. A directory any
   * plugin declares without signals forwards everything, since that plugin asked for every change.
   * @returns Returns the patterns by directory name, an empty list meaning every change.
   */
  public metadataPolicies(): ReadonlyMap<string, readonly string[]> {
    // Asked once per file-system event, and a fetch produces thousands: answered from a cache that
    // outlives a burst, and still notices a plugin installed a moment ago.
    const now: number = Date.now();
    if (this.policies !== null && now - this.policies.at < POLICY_CACHE_MS) {
      return this.policies.value;
    }
    const policies: Map<string, string[] | null> = new Map<string, string[] | null>();
    for (const descriptor of this.options.descriptors()) {
      for (const directory of descriptor.metadataDirectories) {
        const current: string[] | null | undefined = policies.get(directory);
        if (current === null || descriptor.metadataSignals.length === 0) {
          policies.set(directory, null);
        } else {
          policies.set(directory, [...(current ?? []), ...descriptor.metadataSignals]);
        }
      }
    }
    const value: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>(
      [...policies].map(
        ([directory, signals]: [string, string[] | null]): [string, readonly string[]] => [
          directory,
          signals ?? [],
        ],
      ),
    );
    this.policies = { at: now, value };
    return value;
  }

  /**
   * Gets what the plugin serving a repository can do, starting it if it is not running.
   * @param root The absolute repository root.
   * @returns Returns the confirmed capabilities and description, or the reason there are none.
   */
  public async describe(root: string): Promise<PluginDescription> {
    const refusal: string | null = this.refuseRoot(root);
    if (refusal !== null) {
      return { ok: false, error: refusal };
    }
    const descriptor: VersionControlDescriptor | null = this.pluginFor(root);
    return descriptor === null
      ? { ok: false, error: 'No installed version-control plugin recognises this folder.' }
      : this.describePlugin(descriptor.id);
  }

  /**
   * Gets what a named plugin can do, starting it if it is not running — what the setup wizard reports
   * as the version-control tool and its version.
   * @param pluginId The plugin.
   * @returns Returns the confirmed capabilities and description, or the reason there are none.
   */
  public async describePlugin(pluginId: string): Promise<PluginDescription> {
    const descriptor: VersionControlDescriptor | undefined = this.options
      .descriptors()
      .find((candidate: VersionControlDescriptor): boolean => candidate.id === pluginId);
    if (descriptor === undefined) {
      return { ok: false, error: `No version-control plugin named ${pluginId} is installed.` };
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
   * Asks the plugin serving a repository to perform an operation on it.
   * @param root The absolute repository root, which must lie within an open workspace root.
   * @param op The operation, which must not be a global one.
   * @param params The operation's parameters.
   * @returns Returns the plugin's answer, or the host's refusal.
   */
  public async request<Op extends VersionControlOp>(
    root: string,
    op: Op,
    params: VcsParams<Op>,
  ): Promise<VersionControlResponse<Op>> {
    if (VCS_GLOBAL_OPS.includes(op)) {
      return refused(`${op} does not act on a repository.`);
    }
    const refusal: string | null = this.refuseRoot(root);
    if (refusal !== null) {
      return refused(refusal);
    }
    const resolvedRoot: string = path.resolve(root);
    const descriptor: VersionControlDescriptor | null = this.pluginFor(resolvedRoot);
    if (descriptor === null) {
      return refused('No installed version-control plugin recognises this folder.');
    }
    return this.dispatch(descriptor, resolvedRoot, op, params);
  }

  /**
   * Asks a named plugin to perform an operation that acts on no repository. Any path it names must lie
   * within an open workspace root: `resolveRoot`'s path, and the directory a `clone` creates.
   * @param pluginId The plugin to ask.
   * @param op The operation, which must be a global one.
   * @param params The operation's parameters.
   * @returns Returns the plugin's answer, or the host's refusal.
   */
  public async requestGlobal<Op extends VersionControlOp>(
    pluginId: string,
    op: Op,
    params: VcsParams<Op>,
  ): Promise<VersionControlResponse<Op>> {
    if (op === 'initialize' || !VCS_GLOBAL_OPS.includes(op)) {
      return refused(`${op} is not a global request.`);
    }
    const target: unknown =
      op === 'resolveRoot'
        ? (params as VcsParams<'resolveRoot'>).path
        : op === 'clone'
          ? (params as VcsParams<'clone'>).directory
          : null;
    if (target !== null) {
      const refusal: string | null = this.refuseRoot(target);
      if (refusal !== null) {
        return refused(refusal);
      }
    }
    const descriptor: VersionControlDescriptor | undefined = this.options
      .descriptors()
      .find((candidate: VersionControlDescriptor): boolean => candidate.id === pluginId);
    if (descriptor === undefined) {
      return refused(`No version-control plugin named ${pluginId} is installed.`);
    }
    return this.dispatch(descriptor, undefined, op, params);
  }

  /**
   * Gets a contributed plugin by id.
   * @param pluginId The plugin.
   * @returns Returns the descriptor, or undefined when no such plugin is contributed.
   */
  public descriptor(pluginId: string): VersionControlDescriptor | undefined {
    return this.options
      .descriptors()
      .find((candidate: VersionControlDescriptor): boolean => candidate.id === pluginId);
  }

  /**
   * Stops a plugin, so the next request starts it afresh — after its executable choice changed.
   * @param pluginId The plugin.
   */
  public restartPlugin(pluginId: string): void {
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
   * @param root The repository root, or undefined for a global operation.
   * @param op The operation.
   * @param params The operation's parameters.
   * @returns Returns the plugin's answer, or the host's refusal.
   */
  private async dispatch<Op extends VersionControlOp>(
    descriptor: VersionControlDescriptor,
    root: string | undefined,
    op: Op,
    params: VcsParams<Op>,
  ): Promise<VersionControlResponse<Op>> {
    const plugin: RunningPlugin | string = await this.ensure(descriptor);
    if (typeof plugin === 'string') {
      return { id: 0, ok: false, error: plugin };
    }
    const needed: VersionControlCapability | undefined = VCS_OP_CAPABILITY[op];
    if (needed !== undefined && !plugin.capabilities.includes(needed)) {
      return {
        id: 0,
        ok: false,
        error: `${descriptor.displayName} does not support this (${needed}).`,
        code: 'unsupported',
      };
    }
    const timeoutMs: number = VCS_NETWORK_OPS.includes(op)
      ? NETWORK_TIMEOUT_MS
      : REQUEST_TIMEOUT_MS;
    if (!VCS_READ_OPS.includes(op)) {
      return plugin.client.request(op, root, params, timeoutMs);
    }
    const key: string = JSON.stringify([descriptor.id, root ?? null, op, params]);
    const existing: Promise<VersionControlResponse> | undefined = this.inFlightReads.get(key);
    if (existing !== undefined) {
      logger.trace('VersionControlHost', `Shared a concurrent ${op}`);
      return existing;
    }
    const answer: Promise<VersionControlResponse<Op>> = plugin.client.request(
      op,
      root,
      params,
      timeoutMs,
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
  private ensure(descriptor: VersionControlDescriptor): Promise<RunningPlugin | string> {
    const current: RunningPlugin | undefined = this.running.get(descriptor.id);
    if (current?.client.running === true) {
      return Promise.resolve(current);
    }
    this.running.delete(descriptor.id);
    const inProgress: Promise<RunningPlugin | string> | undefined = this.starting.get(
      descriptor.id,
    );
    if (inProgress !== undefined) {
      return inProgress;
    }
    const started: Promise<RunningPlugin | string> = this.start(descriptor).finally((): void => {
      this.starting.delete(descriptor.id);
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
  private async start(descriptor: VersionControlDescriptor): Promise<RunningPlugin | string> {
    const resolution: VersionControlResolution = descriptor.resolve();
    if (!resolution.available) {
      return resolution.reason;
    }
    const create: (id: string, spec: VersionControlSpec) => VersionControlEndpoint =
      this.options.createClient ??
      ((id: string, spec: VersionControlSpec): VersionControlEndpoint =>
        new VersionControlClient(id, spec));
    const client: VersionControlEndpoint =
      'create' in resolution ? resolution.create() : create(descriptor.id, resolution.spec);
    const description: VersionControlDescription | null = await client.start(
      this.options.executableFor(descriptor.id),
    );
    if (description === null) {
      return `${descriptor.displayName} could not be started.`;
    }
    const plugin: RunningPlugin = {
      client,
      description,
      capabilities: descriptor.capabilities.filter(
        (capability: VersionControlCapability): boolean =>
          description.capabilities.includes(capability),
      ),
    };
    this.running.set(descriptor.id, plugin);
    return plugin;
  }

  /**
   * Checks a path a request names: it must be absolute and lie within an open repository or an open
   * workspace root.
   * @param target The candidate path.
   * @returns Returns the reason it is refused, or null when it is acceptable.
   */
  private refuseRoot(target: unknown): string | null {
    if (typeof target !== 'string' || !path.isAbsolute(target)) {
      return 'The path is not absolute.';
    }
    const resolved: string = path.resolve(target);
    const inRepository: boolean = [...this.repositories.keys()].some(
      (root: string): boolean => resolved === root || resolved.startsWith(root + path.sep),
    );
    return inRepository || this.options.roots.isWithin(resolved)
      ? null
      : 'That folder is not an open repository or workspace.';
  }
}

/**
 * Builds the host's refusal of a request it would not send.
 * @param error The reason.
 * @returns Returns the failure.
 */
function refused<Op extends VersionControlOp>(error: string): VersionControlResponse<Op> {
  return { id: 0, ok: false, error, code: 'refused' };
}
