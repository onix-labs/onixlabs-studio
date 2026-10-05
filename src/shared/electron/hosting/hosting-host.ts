import {
  HOSTING_OP_CAPABILITY,
  HOSTING_READ_OPS,
  HOSTING_REPOSITORY_OPS,
  HOSTING_WRITE_OPS,
  HostedRepositoryRef,
  HostingAgentTool,
  HostingAuthMode,
  HostingCapability,
  HostingDescription,
  HostingOp,
  HostingParams,
  HostingResponse,
  parseRemoteUrl,
} from '@shared/api/hosting-protocol';
import { logger } from '../logger';
import { HostingClient } from './hosting-client';
import { HostingDescriptor, HostingResolution, HostingSpec } from './hosting-descriptor';
import { HostingCredentialSource, HostingEndpoint } from './hosting-endpoint';
import {
  HostingCaller,
  hostingAgentToolName,
  hostingOpToolName,
  hostingWriteDecision,
  HostingWriteDecision,
} from './hosting-write-gate';

/**
 * Specifies how long a request may take. Every request reaches another machine, so it is a network's
 * timeout, bounded so a wedged plugin costs one failed operation.
 */
const REQUEST_TIMEOUT_MS: number = 60_000;

/**
 * Specifies how long what a repository allows is reused before it is asked again. A repository's
 * settings rarely change, and a panel polling every few seconds should not re-ask each time.
 */
const REPOSITORY_CAPABILITIES_TTL_MS: number = 5 * 60_000;

/**
 * Describes a running plugin and what it may be asked.
 */
interface RunningPlugin {
  /**
   * Gets the endpoint answering for the plugin.
   */
  readonly client: HostingEndpoint;

  /**
   * Gets the capabilities both the manifest declared and the handshake confirmed.
   */
  readonly capabilities: readonly HostingCapability[];

  /**
   * Gets what the plugin said it is.
   */
  readonly description: HostingDescription;
}

/**
 * Describes what the host depends on, injectable so it is testable without processes.
 */
export interface HostingHostOptions {
  /**
   * Gets the contributed hosting plugins, read afresh each time so an install or uninstall is seen
   * without a restart.
   */
  readonly descriptors: () => readonly HostingDescriptor[];

  /**
   * Gets the user's sign-in choice for each of a plugin's hosts that has one.
   */
  readonly authFor: (pluginId: string) => Readonly<Record<string, HostingAuthMode>>;

  /**
   * Reads a host's credential from Studio's store, or null when it holds none.
   */
  readonly credential: (host: string) => Promise<string | null>;

  /**
   * Creates the client for a plugin's process. Defaults to a real process.
   */
  readonly createClient?: (
    id: string,
    spec: HostingSpec,
    credentials: HostingCredentialSource,
  ) => HostingEndpoint;

  /**
   * Gets the current time in milliseconds. Defaults to the clock.
   */
  readonly now?: () => number;
}

/**
 * Describes what a plugin can do, or why it cannot be asked.
 */
export type HostingPluginDescription =
  | {
      readonly ok: true;
      readonly pluginId: string;
      readonly description: HostingDescription;
      readonly capabilities: readonly HostingCapability[];
    }
  | { readonly ok: false; readonly error: string };

/**
 * Describes what a repository allows, or why it cannot be said.
 */
export type HostedRepositoryDescription =
  | {
      readonly ok: true;
      readonly pluginId: string;
      readonly displayName: string;

      /**
       * Gets the capabilities the plugin has *and* the repository allows — what the UI offers.
       */
      readonly capabilities: readonly HostingCapability[];
    }
  | { readonly ok: false; readonly error: string };

/**
 * Hosts the hosting plugins in the main process (#819): finds which one serves a host, starts it on
 * first use, and stands between it and its callers.
 *
 * ⛔ Every check lives here rather than in the plugin, because a plugin is code Studio did not write:
 * - a request may name only a host the plugin's manifest declares;
 * - a request needing a capability the plugin did not both declare and confirm, or that the repository
 *   it names does not allow, is refused without the plugin seeing it;
 * - a plugin is handed the credential of a host it declares, and only when the user has not chosen the
 *   host's own CLI login for it;
 * - an agent's write goes through the run's permission posture and per-tool policies;
 * - identical concurrent reads are answered by one request.
 */
export class HostingHost {
  /**
   * Holds the dependencies.
   */
  private readonly options: HostingHostOptions;

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
   * Holds the reads in flight, keyed by plugin, operation and parameters.
   */
  private readonly inFlightReads: Map<string, Promise<HostingResponse>> = new Map<
    string,
    Promise<HostingResponse>
  >();

  /**
   * Holds what each repository allows and when it was asked, keyed by plugin and repository.
   */
  private readonly repositoryCapabilities: Map<
    string,
    { readonly at: number; readonly capabilities: readonly HostingCapability[] }
  > = new Map<string, { at: number; capabilities: readonly HostingCapability[] }>();

  /**
   * Initializes the host.
   * @param options What the host depends on.
   */
  public constructor(options: HostingHostOptions) {
    this.options = options;
  }

  /**
   * Finds the plugin serving a host: among those declaring it, the highest priority.
   * @param host The host name.
   * @returns Returns the plugin, or null when no contributed plugin serves the host.
   */
  public pluginForHost(host: string): HostingDescriptor | null {
    const name: string = host.toLowerCase();
    const candidates: HostingDescriptor[] = this.options
      .descriptors()
      .filter((descriptor: HostingDescriptor): boolean => descriptor.hosts.includes(name));
    candidates.sort(
      (a: HostingDescriptor, b: HostingDescriptor): number => b.priority - a.priority,
    );
    return candidates[0] ?? null;
  }

  /**
   * Gets every contributed plugin, highest priority first.
   * @returns Returns the descriptors.
   */
  public preferredOrder(): readonly HostingDescriptor[] {
    return [...this.options.descriptors()].sort(
      (a: HostingDescriptor, b: HostingDescriptor): number => b.priority - a.priority,
    );
  }

  /**
   * Finds the repository a git remote points at, and the plugin serving its host — what replaces the
   * host table core kept for GitHub.
   * @param remoteUrl The remote's URL.
   * @returns Returns the repository and plugin, or null when the remote names no repository a
   * contributed plugin serves.
   */
  public detect(
    remoteUrl: unknown,
  ): { readonly repository: HostedRepositoryRef; readonly plugin: HostingDescriptor } | null {
    if (typeof remoteUrl !== 'string') {
      return null;
    }
    const repository: HostedRepositoryRef | null = parseRemoteUrl(remoteUrl);
    const plugin: HostingDescriptor | null =
      repository === null ? null : this.pluginForHost(repository.host);
    return repository === null || plugin === null ? null : { repository, plugin };
  }

  /**
   * Gets what a named plugin can do, starting it if it is not running.
   * @param pluginId The plugin.
   * @returns Returns the confirmed capabilities and description, or the reason there are none.
   */
  public async describePlugin(pluginId: string): Promise<HostingPluginDescription> {
    const descriptor: HostingDescriptor | undefined = this.descriptor(pluginId);
    if (descriptor === undefined) {
      return { ok: false, error: `No hosting plugin named ${pluginId} is installed.` };
    }
    const plugin: RunningPlugin | string = await this.ensure(descriptor);
    return typeof plugin === 'string'
      ? { ok: false, error: plugin }
      : {
          ok: true,
          pluginId,
          description: plugin.description,
          capabilities: plugin.capabilities,
        };
  }

  /**
   * Gets what a repository allows: the capabilities its plugin has, narrowed to those the repository
   * itself allows. What the UI gates its controls on.
   * @param repository The repository.
   * @returns Returns the capabilities, or the reason there are none.
   */
  public async describeRepository(repository: unknown): Promise<HostedRepositoryDescription> {
    const ref: HostedRepositoryRef | null = readRepository(repository);
    if (ref === null) {
      return { ok: false, error: 'That is not a repository on a host.' };
    }
    const descriptor: HostingDescriptor | null = this.pluginForHost(ref.host);
    if (descriptor === null) {
      return { ok: false, error: `No installed hosting plugin serves ${ref.host}.` };
    }
    const plugin: RunningPlugin | string = await this.ensure(descriptor);
    if (typeof plugin === 'string') {
      return { ok: false, error: plugin };
    }
    const allowed: readonly HostingCapability[] | string = await this.repositoryAllows(
      descriptor,
      plugin,
      ref,
    );
    return typeof allowed === 'string'
      ? { ok: false, error: allowed }
      : {
          ok: true,
          pluginId: descriptor.id,
          displayName: descriptor.displayName,
          capabilities: allowed,
        };
  }

  /**
   * Asks the plugin serving the host a request names to perform it. Repository requests are routed by
   * `params.repository.host`, account requests by `params.host`.
   * @param op The operation.
   * @param params The operation's parameters.
   * @param caller Who is asking, which decides whether a write needs permission.
   * @returns Returns the plugin's answer, or the host's refusal.
   */
  public async request<Op extends HostingOp>(
    op: Op,
    params: HostingParams<Op>,
    caller: HostingCaller,
  ): Promise<HostingResponse<Op>> {
    const host: string | null = hostOf(params);
    if (host === null) {
      return refused(`${op} names no host.`);
    }
    const descriptor: HostingDescriptor | null = this.pluginForHost(host);
    if (descriptor === null) {
      return refused(`No installed hosting plugin serves ${host}.`);
    }
    return this.requestFor(descriptor.id, op, params, caller);
  }

  /**
   * Asks a named plugin to perform a request — for one that names no host (an agent tool with no
   * repository), or when the caller already knows the plugin. Any host the request names must be one
   * the plugin declares.
   * @param pluginId The plugin to ask.
   * @param op The operation.
   * @param params The operation's parameters.
   * @param caller Who is asking.
   * @returns Returns the plugin's answer, or the host's refusal.
   */
  public async requestFor<Op extends HostingOp>(
    pluginId: string,
    op: Op,
    params: HostingParams<Op>,
    caller: HostingCaller,
  ): Promise<HostingResponse<Op>> {
    if (op === 'initialize') {
      return refused('initialize is not a request a caller makes.');
    }
    const descriptor: HostingDescriptor | undefined = this.descriptor(pluginId);
    if (descriptor === undefined) {
      return refused(`No hosting plugin named ${pluginId} is installed.`);
    }
    const host: string | null = hostOf(params);
    if (host !== null && !descriptor.hosts.includes(host)) {
      return refused(`${descriptor.displayName} does not serve ${host}.`);
    }
    if (HOSTING_REPOSITORY_OPS.includes(op) && readRepository(repositoryOf(params)) === null) {
      return refused(`${op} needs a repository.`);
    }
    const plugin: RunningPlugin | string = await this.ensure(descriptor);
    if (typeof plugin === 'string') {
      return { id: 0, ok: false, error: plugin };
    }
    const unsupported: string | null = await this.refuseCapability(descriptor, plugin, op, params);
    if (unsupported !== null) {
      return { id: 0, ok: false, error: unsupported, code: 'unsupported' };
    }
    const denied: string | null = await this.gateWrite(descriptor, plugin, op, params, caller);
    if (denied !== null) {
      return refused(denied);
    }
    return this.dispatch(descriptor, plugin, op, params);
  }

  /**
   * Gets a contributed plugin by id.
   * @param pluginId The plugin.
   * @returns Returns the descriptor, or undefined when no such plugin is contributed.
   */
  public descriptor(pluginId: string): HostingDescriptor | undefined {
    return this.options
      .descriptors()
      .find((candidate: HostingDescriptor): boolean => candidate.id === pluginId);
  }

  /**
   * Stops a plugin, so the next request starts it afresh — after its sign-in choice changed — and
   * forgets what its repositories allowed, which a different account may see differently.
   * @param pluginId The plugin.
   */
  public restartPlugin(pluginId: string): void {
    this.running.get(pluginId)?.client.dispose();
    this.running.delete(pluginId);
    this.starting.delete(pluginId);
    for (const key of [...this.repositoryCapabilities.keys()]) {
      if (key.startsWith(`${pluginId}\u0000`)) {
        this.repositoryCapabilities.delete(key);
      }
    }
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
    this.repositoryCapabilities.clear();
  }

  /**
   * Answers a plugin's request for a host's credential. Only a host the plugin's manifest declares,
   * and only when the user has not chosen the host's own CLI login for it — a plugin told to use `gh`
   * has no business holding Studio's token as well.
   * @param descriptor The plugin asking.
   * @param host The host whose credential it wants.
   * @returns Returns the credential, or null when it is not the plugin's to have.
   */
  private async credentialFor(descriptor: HostingDescriptor, host: string): Promise<string | null> {
    const name: string = host.toLowerCase();
    if (!descriptor.hosts.includes(name)) {
      logger.warn(
        'HostingHost',
        `'${descriptor.id}' asked for the credential of ${name}, which it does not serve; refused`,
      );
      return null;
    }
    if (this.options.authFor(descriptor.id)[name] === 'cli') {
      logger.debug('HostingHost', `'${descriptor.id}' signs in to ${name} with its CLI; no token`);
      return null;
    }
    return this.options.credential(name);
  }

  /**
   * Checks a request against the capabilities its plugin confirmed and, for a repository request, what
   * the repository allows.
   * @param descriptor The plugin.
   * @param plugin Its running instance.
   * @param op The operation.
   * @param params The operation's parameters.
   * @returns Returns the reason the request is unsupported, or null when it is not.
   */
  private async refuseCapability(
    descriptor: HostingDescriptor,
    plugin: RunningPlugin,
    op: HostingOp,
    params: unknown,
  ): Promise<string | null> {
    const needed: HostingCapability | undefined = HOSTING_OP_CAPABILITY[op];
    if (needed === undefined) {
      return null;
    }
    if (!plugin.capabilities.includes(needed)) {
      return `${descriptor.displayName} does not support this (${needed}).`;
    }
    // Only the shared vocabulary's repository requests are narrowed by what the repository allows. An
    // agent tool's repository is context for the tool, not a feature the repository can switch off.
    const repository: HostedRepositoryRef | null = HOSTING_REPOSITORY_OPS.includes(op)
      ? readRepository(repositoryOf(params))
      : null;
    if (repository === null || op === 'describeRepository') {
      return null;
    }
    const allowed: readonly HostingCapability[] | string = await this.repositoryAllows(
      descriptor,
      plugin,
      repository,
    );
    if (typeof allowed === 'string') {
      // What the repository allows could not be read. Ask anyway: the host's own answer is then the
      // judge, and a panel stays useful when only the description call failed.
      return null;
    }
    return allowed.includes(needed)
      ? null
      : `${repository.owner}/${repository.name} does not allow this (${needed}).`;
  }

  /**
   * Puts an agent's write through the run's permission posture and per-tool policies. A user's request,
   * and any read, passes straight through.
   * @param descriptor The plugin.
   * @param plugin Its running instance.
   * @param op The operation.
   * @param params The operation's parameters.
   * @param caller Who is asking.
   * @returns Returns the reason the write is refused, or null when it may be sent.
   */
  private async gateWrite(
    descriptor: HostingDescriptor,
    plugin: RunningPlugin,
    op: HostingOp,
    params: unknown,
    caller: HostingCaller,
  ): Promise<string | null> {
    if (caller.kind === 'user') {
      return null;
    }
    let tool: string;
    let summary: string;
    if (op === 'invokeAgentTool') {
      const invocation: HostingParams<'invokeAgentTool'> =
        params as HostingParams<'invokeAgentTool'>;
      const offered: HostingAgentTool | string = await this.agentTool(
        descriptor,
        plugin,
        invocation,
      );
      if (typeof offered === 'string') {
        return offered;
      }
      if (!offered.writes) {
        return null;
      }
      tool = hostingAgentToolName(descriptor.id, offered.name);
      summary = `${descriptor.displayName}: ${offered.name}`;
    } else if (HOSTING_WRITE_OPS.includes(op)) {
      tool = hostingOpToolName(op);
      summary = `${descriptor.displayName}: ${op}`;
    } else {
      return null;
    }
    const decision: HostingWriteDecision = hostingWriteDecision(
      tool,
      caller.posture,
      caller.policies,
    );
    logger.info('HostingHost', `Agent write ${tool}: ${decision}`);
    if (decision === 'deny') {
      return `${tool} is denied for agents in this run.`;
    }
    if (decision === 'ask' && !(await caller.confirm(summary))) {
      return 'The write was declined.';
    }
    return null;
  }

  /**
   * Finds the agent tool an invocation names among those the plugin offers.
   * @param descriptor The plugin.
   * @param plugin Its running instance.
   * @param invocation The invocation.
   * @returns Returns the tool, or the reason it is not one the plugin offers.
   */
  private async agentTool(
    descriptor: HostingDescriptor,
    plugin: RunningPlugin,
    invocation: HostingParams<'invokeAgentTool'>,
  ): Promise<HostingAgentTool | string> {
    const listed: HostingResponse<'listAgentTools'> = await this.dispatch(
      descriptor,
      plugin,
      'listAgentTools',
      invocation.repository === undefined ? {} : { repository: invocation.repository },
    );
    if (!listed.ok) {
      return listed.error;
    }
    return (
      listed.result.find((tool: HostingAgentTool): boolean => tool.name === invocation.name) ??
      `${descriptor.displayName} offers no tool named ${invocation.name}.`
    );
  }

  /**
   * Gets what a repository allows, narrowed to what the plugin has, from the cache when it is fresh.
   * @param descriptor The plugin.
   * @param plugin Its running instance.
   * @param repository The repository.
   * @returns Returns the capabilities, or the reason they could not be read.
   */
  private async repositoryAllows(
    descriptor: HostingDescriptor,
    plugin: RunningPlugin,
    repository: HostedRepositoryRef,
  ): Promise<readonly HostingCapability[] | string> {
    const now: number = (this.options.now ?? Date.now)();
    const key: string = [descriptor.id, repository.host, repository.owner, repository.name]
      .join('\u0000')
      .toLowerCase();
    const cached: { at: number; capabilities: readonly HostingCapability[] } | undefined =
      this.repositoryCapabilities.get(key);
    if (cached !== undefined && now - cached.at < REPOSITORY_CAPABILITIES_TTL_MS) {
      return cached.capabilities;
    }
    const described: HostingResponse<'describeRepository'> = await this.dispatch(
      descriptor,
      plugin,
      'describeRepository',
      { repository },
    );
    if (!described.ok) {
      return described.error;
    }
    const capabilities: readonly HostingCapability[] = plugin.capabilities.filter(
      (capability: HostingCapability): boolean =>
        described.result.capabilities.includes(capability),
    );
    this.repositoryCapabilities.set(key, { at: now, capabilities });
    return capabilities;
  }

  /**
   * Sends a request, sharing an identical read already in flight.
   * @param descriptor The plugin.
   * @param plugin Its running instance.
   * @param op The operation.
   * @param params The operation's parameters.
   * @returns Returns the plugin's answer.
   */
  private async dispatch<Op extends HostingOp>(
    descriptor: HostingDescriptor,
    plugin: RunningPlugin,
    op: Op,
    params: HostingParams<Op>,
  ): Promise<HostingResponse<Op>> {
    if (!HOSTING_READ_OPS.includes(op)) {
      return plugin.client.request(op, params, REQUEST_TIMEOUT_MS);
    }
    const key: string = JSON.stringify([descriptor.id, op, params]);
    const existing: Promise<HostingResponse> | undefined = this.inFlightReads.get(key);
    if (existing !== undefined) {
      logger.trace('HostingHost', `Shared a concurrent ${op}`);
      return existing;
    }
    const answer: Promise<HostingResponse<Op>> = plugin.client.request(
      op,
      params,
      REQUEST_TIMEOUT_MS,
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
  private ensure(descriptor: HostingDescriptor): Promise<RunningPlugin | string> {
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
   * handshake confirmed.
   * @param descriptor The plugin.
   * @returns Returns the running plugin, or the reason it could not be started.
   */
  private async start(descriptor: HostingDescriptor): Promise<RunningPlugin | string> {
    const resolution: HostingResolution = descriptor.resolve();
    if (!resolution.available) {
      return resolution.reason;
    }
    const credentials: HostingCredentialSource = (host: string): Promise<string | null> =>
      this.credentialFor(descriptor, host);
    const create: (
      id: string,
      spec: HostingSpec,
      source: HostingCredentialSource,
    ) => HostingEndpoint =
      this.options.createClient ??
      ((id: string, spec: HostingSpec, source: HostingCredentialSource): HostingEndpoint =>
        new HostingClient(id, spec, source));
    const client: HostingEndpoint =
      'create' in resolution
        ? resolution.create()
        : create(descriptor.id, resolution.spec, credentials);
    const description: HostingDescription | null = await client.start(
      this.options.authFor(descriptor.id),
    );
    if (description === null) {
      return `${descriptor.displayName} could not be started.`;
    }
    const plugin: RunningPlugin = {
      client,
      description,
      capabilities: descriptor.capabilities.filter((capability: HostingCapability): boolean =>
        description.capabilities.includes(capability),
      ),
    };
    this.running.set(descriptor.id, plugin);
    return plugin;
  }
}

/**
 * Narrows an untrusted value to a repository reference, lowercasing its host.
 * @param value The candidate.
 * @returns Returns the reference, or null when it is not one.
 */
function readRepository(value: unknown): HostedRepositoryRef | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const { host, owner, name } = record;
  return typeof host === 'string' &&
    typeof owner === 'string' &&
    typeof name === 'string' &&
    host.length > 0 &&
    owner.length > 0 &&
    name.length > 0
    ? { host: host.toLowerCase(), owner, name }
    : null;
}

/**
 * Gets the repository a request's parameters name, if any.
 * @param params The parameters.
 * @returns Returns the candidate repository, or undefined.
 */
function repositoryOf(params: unknown): unknown {
  return typeof params === 'object' && params !== null
    ? (params as Record<string, unknown>)['repository']
    : undefined;
}

/**
 * Gets the host a request's parameters name — `host` for an account request, `repository.host` for a
 * repository request — lowercased.
 * @param params The parameters.
 * @returns Returns the host, or null when the request names none.
 */
function hostOf(params: unknown): string | null {
  if (typeof params !== 'object' || params === null) {
    return null;
  }
  const direct: unknown = (params as Record<string, unknown>)['host'];
  if (typeof direct === 'string' && direct.length > 0) {
    return direct.toLowerCase();
  }
  return readRepository(repositoryOf(params))?.host ?? null;
}

/**
 * Builds the host's refusal of a request it would not send.
 * @param error The reason.
 * @returns Returns the failure.
 */
function refused<Op extends HostingOp>(error: string): HostingResponse<Op> {
  return { id: 0, ok: false, error, code: 'refused' };
}
