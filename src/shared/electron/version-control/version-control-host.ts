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
   * Gets the plugin's client.
   */
  readonly client: VersionControlClient;

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
   * Creates the client for a plugin. Defaults to a real process.
   */
  readonly createClient?: (id: string, spec: VersionControlSpec) => VersionControlClient;
}

/**
 * Hosts the version-control plugins in the main process (#815): finds which one serves a repository,
 * starts it on first use, and stands between it and an untrusted renderer.
 *
 * ⛔ Every check lives here rather than in the plugin, because a plugin is code Studio did not write:
 * - a request's root must be absolute and lie within an open workspace root — the confinement
 *   `GitManager.isOpenRoot` applies today;
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
   * Gets the version-control systems' own directory names across every contributed plugin, for the
   * directory watcher and write confinement.
   * @returns Returns the distinct names.
   */
  public metadataDirectories(): readonly string[] {
    return [
      ...new Set(
        this.options
          .descriptors()
          .flatMap(
            (descriptor: VersionControlDescriptor): readonly string[] =>
              descriptor.metadataDirectories,
          ),
      ),
    ];
  }

  /**
   * Gets what the plugin serving a repository can do, starting it if it is not running.
   * @param root The absolute repository root.
   * @returns Returns the confirmed capabilities and description, or the reason there are none.
   */
  public async describe(root: string): Promise<
    | {
        readonly ok: true;
        readonly pluginId: string;
        readonly description: VersionControlDescription;
        readonly capabilities: readonly VersionControlCapability[];
      }
    | { readonly ok: false; readonly error: string }
  > {
    const refusal: string | null = this.refuseRoot(root);
    if (refusal !== null) {
      return { ok: false, error: refusal };
    }
    const descriptor: VersionControlDescriptor | null = this.pluginFor(root);
    if (descriptor === null) {
      return { ok: false, error: 'No installed version-control plugin recognises this folder.' };
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
    const create: (id: string, spec: VersionControlSpec) => VersionControlClient =
      this.options.createClient ??
      ((id: string, spec: VersionControlSpec): VersionControlClient =>
        new VersionControlClient(id, spec));
    const client: VersionControlClient = create(descriptor.id, resolution.spec);
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
   * Checks a path a request names: it must be an absolute path within an open workspace root.
   * @param target The candidate path.
   * @returns Returns the reason it is refused, or null when it is acceptable.
   */
  private refuseRoot(target: unknown): string | null {
    if (typeof target !== 'string' || !path.isAbsolute(target)) {
      return 'The path is not absolute.';
    }
    return this.options.roots.isWithin(target) ? null : 'That folder is not an open workspace.';
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
