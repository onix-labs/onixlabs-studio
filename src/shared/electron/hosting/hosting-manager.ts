import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { ForgeChannel } from '@shared/api/forge-channels';
import {
  ForgeAuthStatus,
  ForgeHostAccount,
  ForgeIssue,
  ForgeIssueComment,
  ForgePullRequest,
  ForgeRepositoryCapabilities,
  ForgeRepositoryRef,
  ForgeResult,
  ForgeWorkflowRun,
} from '@shared/api/forge-types';
import {
  HostedAccount,
  HostedAuthStatus,
  HostedRepository,
  HostedRepositoryRef,
  HostingAuthMode,
  HostingOp,
  HostingParams,
  HostingResponse,
  HostingResult,
  isHostingAuthMode,
} from '@shared/api/hosting-protocol';
import { logger } from '../logger';
import { HostingCredentialStore } from './hosting-credential-store';
import { HostingDescriptor } from './hosting-descriptor';
import { HostedRepositoryDescription, HostingHost } from './hosting-host';
import { HostingSettings } from './hosting-settings';
import { HostingCaller } from './hosting-write-gate';

/**
 * The caller every request from Studio's own controls is made as: the user, acting.
 */
const USER: HostingCaller = { kind: 'user' };

/**
 * Serves the renderer's forge surfaces — the source-control panels' Pull Requests, Issues and Actions
 * sections, and the settings page's sign-in — over the hosting host (#820).
 *
 * The forge contribution this replaces spoke GitHub itself. Now every answer comes from whichever
 * hosting plugin serves the repository's host, and with none installed there is no forge: detection
 * finds nothing, and the sections are absent rather than broken.
 *
 * The token the user pastes in Settings stays in core's encrypted store; the plugin is handed it only
 * when it asks, and the renderer never sees it. Which hosts there are to sign in to comes from the
 * installed plugins' manifests (#821): core names none.
 */
export class HostingManager {
  /**
   * Initializes the manager.
   * @param host The hosting host.
   * @param store The token store.
   * @param settings How each plugin signs in to each of its hosts.
   */
  public constructor(
    private readonly host: HostingHost,
    private readonly store: HostingCredentialStore,
    private readonly settings: HostingSettings,
  ) {}

  /**
   * Registers the forge IPC handlers.
   */
  public register(): void {
    logger.info('HostingManager', 'Registering forge IPC handlers');
    ipcMain.handle(
      ForgeChannel.Detect,
      (_event: IpcMainInvokeEvent, remoteUrl: unknown): ForgeRepositoryRef | null =>
        this.detect(remoteUrl),
    );
    ipcMain.handle(
      ForgeChannel.Describe,
      (
        _event: IpcMainInvokeEvent,
        repository: unknown,
      ): Promise<ForgeRepositoryCapabilities | null> => this.describe(repository),
    );
    ipcMain.handle(ForgeChannel.Hosts, (): Promise<readonly ForgeHostAccount[]> => this.hosts());
    ipcMain.handle(
      ForgeChannel.SetAuthMode,
      (
        _event: IpcMainInvokeEvent,
        pluginId: unknown,
        host: unknown,
        mode: unknown,
      ): Promise<ForgeHostAccount | null> => this.setAuthMode(pluginId, host, mode),
    );
    ipcMain.handle(
      ForgeChannel.SetToken,
      (
        _event: IpcMainInvokeEvent,
        pluginId: unknown,
        host: unknown,
        token: unknown,
      ): Promise<ForgeHostAccount | null> =>
        this.setToken(pluginId, host, typeof token === 'string' ? token : ''),
    );
    ipcMain.handle(
      ForgeChannel.ClearToken,
      (
        _event: IpcMainInvokeEvent,
        pluginId: unknown,
        host: unknown,
      ): Promise<ForgeHostAccount | null> => this.setToken(pluginId, host, ''),
    );
    ipcMain.handle(
      ForgeChannel.PullRequests,
      (
        _event: IpcMainInvokeEvent,
        repository: unknown,
      ): Promise<ForgeResult<readonly ForgePullRequest[]>> =>
        this.read(repository, 'listPullRequests', (target) => ({ repository: target })),
    );
    ipcMain.handle(
      ForgeChannel.Issues,
      (
        _event: IpcMainInvokeEvent,
        repository: unknown,
      ): Promise<ForgeResult<readonly ForgeIssue[]>> =>
        this.read(repository, 'listIssues', (target) => ({ repository: target })),
    );
    ipcMain.handle(
      ForgeChannel.IssueComments,
      (
        _event: IpcMainInvokeEvent,
        repository: unknown,
        issueNumber: unknown,
      ): Promise<ForgeResult<readonly ForgeIssueComment[]>> =>
        this.read(repository, 'listIssueComments', (target) => ({
          repository: target,
          issue: asIssueNumber(issueNumber),
        })),
    );
    ipcMain.handle(
      ForgeChannel.WorkflowRuns,
      (
        _event: IpcMainInvokeEvent,
        repository: unknown,
      ): Promise<ForgeResult<readonly ForgeWorkflowRun[]>> =>
        this.read(repository, 'listCiRuns', (target) => ({ repository: target })),
    );
    ipcMain.handle(
      ForgeChannel.RerunWorkflowRun,
      (
        _event: IpcMainInvokeEvent,
        repository: unknown,
        runId: unknown,
      ): Promise<ForgeResult<void>> => this.runCommand(repository, runId, 'rerunCiRun'),
    );
    ipcMain.handle(
      ForgeChannel.CancelWorkflowRun,
      (
        _event: IpcMainInvokeEvent,
        repository: unknown,
        runId: unknown,
      ): Promise<ForgeResult<void>> => this.runCommand(repository, runId, 'cancelCiRun'),
    );
    ipcMain.handle(
      ForgeChannel.Accounts,
      (_event: IpcMainInvokeEvent, host: unknown): Promise<ForgeResult<readonly HostedAccount[]>> =>
        this.accounts(host),
    );
    ipcMain.handle(
      ForgeChannel.Repositories,
      (
        _event: IpcMainInvokeEvent,
        host: unknown,
        account: unknown,
      ): Promise<ForgeResult<readonly HostedRepository[]>> => this.repositories(host, account),
    );
  }

  /**
   * Lists the accounts the user acts as on a host (#805).
   * @param host The untrusted host.
   * @returns Returns the accounts, or why they could not be read.
   */
  public async accounts(host: unknown): Promise<ForgeResult<readonly HostedAccount[]>> {
    const name: string | null = this.servedHost(host);
    if (name === null) {
      return { ok: false, error: 'No installed plugin serves that host.', unauthorized: false };
    }
    return toResult(await this.host.request('listAccounts', { host: name }, USER));
  }

  /**
   * Lists an account's repositories on a host (#805).
   * @param host The untrusted host.
   * @param account The untrusted account login.
   * @returns Returns the repositories, or why they could not be read.
   */
  public async repositories(
    host: unknown,
    account: unknown,
  ): Promise<ForgeResult<readonly HostedRepository[]>> {
    const name: string | null = this.servedHost(host);
    if (name === null) {
      return { ok: false, error: 'No installed plugin serves that host.', unauthorized: false };
    }
    if (typeof account !== 'string' || account.length === 0 || /[/\\?#\s]/.test(account)) {
      return { ok: false, error: 'No account was named.', unauthorized: false };
    }
    return toResult(await this.host.request('listRepositories', { host: name, account }, USER));
  }

  /**
   * Validates a host the renderer named: an installed plugin must be the one to sign in to it.
   * @param host The untrusted host.
   * @returns Returns the lowercased host, or null.
   */
  private servedHost(host: unknown): string | null {
    if (typeof host !== 'string') {
      return null;
    }
    const name: string = host.toLowerCase();
    return this.host
      .preferredOrder()
      .some(
        (descriptor: HostingDescriptor): boolean =>
          descriptor.resolve().available && this.servedHosts(descriptor).includes(name),
      )
      ? name
      : null;
  }

  /**
   * Stops every running hosting plugin.
   */
  public dispose(): void {
    this.host.dispose();
  }

  /**
   * Resolves a git remote to the repository it names, when an installed plugin serves its host.
   * @param remoteUrl The remote's URL.
   * @returns Returns the reference, or null.
   */
  public detect(remoteUrl: unknown): ForgeRepositoryRef | null {
    const detected: ReturnType<HostingHost['detect']> = this.host.detect(remoteUrl);
    if (detected?.plugin.resolve().available !== true) {
      return null;
    }
    return { provider: detected.plugin.displayName, ...detected.repository };
  }

  /**
   * Says what a repository allows.
   * @param repository The untrusted reference.
   * @returns Returns the capabilities, or null when no installed plugin serves it.
   */
  public async describe(repository: unknown): Promise<ForgeRepositoryCapabilities | null> {
    const target: HostedRepositoryRef | null = asRepository(repository);
    if (target === null) {
      return null;
    }
    const described: HostedRepositoryDescription = await this.host.describeRepository(target);
    return described.ok
      ? { provider: described.displayName, capabilities: described.capabilities }
      : null;
  }

  /**
   * Lists every host the installed hosting plugins serve, with how each is signed in. A host appears
   * under the plugin that serves it — the highest priority among those declaring it — and a `www.`
   * alias of a host the plugin also declares is not listed apart from it.
   * @returns Returns the hosts, highest-priority plugin first.
   */
  public async hosts(): Promise<readonly ForgeHostAccount[]> {
    const pairs: { descriptor: HostingDescriptor; host: string }[] = [];
    for (const descriptor of this.host.preferredOrder()) {
      if (!descriptor.resolve().available) {
        continue;
      }
      for (const host of this.servedHosts(descriptor)) {
        pairs.push({ descriptor, host });
      }
    }
    return Promise.all(
      pairs.map(({ descriptor, host }: { descriptor: HostingDescriptor; host: string }) =>
        this.account(descriptor, host),
      ),
    );
  }

  /**
   * Chooses how a plugin signs in to one of its hosts, and to that host's `www.` alias, restarting the
   * plugin so it starts afresh with the choice.
   * @param pluginId The untrusted plugin id.
   * @param host The untrusted host.
   * @param mode The untrusted mode, or null to let the plugin decide.
   * @returns Returns the host's resulting account, or null when the plugin does not serve it or does
   * not offer the mode.
   */
  public async setAuthMode(
    pluginId: unknown,
    host: unknown,
    mode: unknown,
  ): Promise<ForgeHostAccount | null> {
    const target: { descriptor: HostingDescriptor; host: string } | null = this.served(
      pluginId,
      host,
    );
    if (target === null) {
      return null;
    }
    const choice: HostingAuthMode | null =
      mode === null ? null : isHostingAuthMode(mode) ? mode : null;
    if (mode !== null && (choice === null || !target.descriptor.authModes.includes(choice))) {
      return null;
    }
    for (const name of this.withAliases(target.descriptor, target.host)) {
      this.settings.setAuth(target.descriptor.id, name, choice);
    }
    this.host.restartPlugin(target.descriptor.id);
    logger.info(
      'HostingManager',
      `${target.descriptor.id} signs in to ${target.host} with ${choice ?? 'its default'}`,
    );
    return this.account(target.descriptor, target.host);
  }

  /**
   * Stores (or, given a blank token, clears) the token Studio keeps for a host and its `www.` alias,
   * restarting the plugin so nothing it learnt under the old credential outlives it.
   * @param pluginId The untrusted plugin id.
   * @param host The untrusted host.
   * @param token The token.
   * @returns Returns the host's resulting account, or null when the plugin does not serve it.
   */
  public async setToken(
    pluginId: unknown,
    host: unknown,
    token: string,
  ): Promise<ForgeHostAccount | null> {
    const target: { descriptor: HostingDescriptor; host: string } | null = this.served(
      pluginId,
      host,
    );
    if (target === null) {
      return null;
    }
    for (const name of this.withAliases(target.descriptor, target.host)) {
      this.store.setToken(name, token);
    }
    this.host.restartPlugin(target.descriptor.id);
    logger.info(
      'HostingManager',
      `${token.trim().length > 0 ? 'Stored' : 'Cleared'} the ${target.host} token`,
    );
    return this.account(target.descriptor, target.host);
  }

  /**
   * Reads how a plugin is signed in to one host.
   * @param descriptor The plugin.
   * @param host The host.
   * @returns Returns the account.
   */
  private async account(descriptor: HostingDescriptor, host: string): Promise<ForgeHostAccount> {
    return {
      pluginId: descriptor.id,
      provider: descriptor.displayName,
      host,
      authModes: descriptor.authModes,
      authMode: this.settings.authFor(descriptor.id)[host] ?? null,
      status: await this.authStatus(host),
    };
  }

  /**
   * Asks the plugin serving a host how it is signed in to it.
   * @param host The host.
   * @returns Returns the status.
   */
  private async authStatus(host: string): Promise<ForgeAuthStatus> {
    const hasStoredToken: boolean = this.store.hasStoredToken(host);
    const response: HostingResponse<'authStatus'> = await this.host.request(
      'authStatus',
      { host },
      USER,
    );
    if (!response.ok) {
      return {
        mode: null,
        authenticated: false,
        hasStoredToken,
        identity: null,
        detail: response.error,
      };
    }
    const status: HostedAuthStatus = response.result;
    return {
      mode: status.mode,
      authenticated: status.authenticated,
      hasStoredToken,
      identity: status.identity,
      detail: status.detail,
    };
  }

  /**
   * Gets the hosts a plugin is the one to sign in to: those it declares and serves, less the `www.`
   * aliases of others it declares.
   * @param descriptor The plugin.
   * @returns Returns the hosts, in manifest order.
   */
  private servedHosts(descriptor: HostingDescriptor): readonly string[] {
    return descriptor.hosts.filter(
      (host: string): boolean =>
        !(host.startsWith('www.') && descriptor.hosts.includes(host.slice('www.'.length))) &&
        this.host.pluginForHost(host)?.id === descriptor.id,
    );
  }

  /**
   * Gets a host together with its `www.` alias, when the plugin declares that too.
   * @param descriptor The plugin.
   * @param host The host.
   * @returns Returns the host names.
   */
  private withAliases(descriptor: HostingDescriptor, host: string): readonly string[] {
    const alias: string = `www.${host}`;
    return descriptor.hosts.includes(alias) ? [host, alias] : [host];
  }

  /**
   * Validates a plugin and host the renderer named: the plugin must be installed and be the one to
   * sign in to the host.
   * @param pluginId The untrusted plugin id.
   * @param host The untrusted host.
   * @returns Returns the plugin and the lowercased host, or null.
   */
  private served(
    pluginId: unknown,
    host: unknown,
  ): { descriptor: HostingDescriptor; host: string } | null {
    if (typeof pluginId !== 'string' || typeof host !== 'string') {
      return null;
    }
    const descriptor: HostingDescriptor | undefined = this.host.descriptor(pluginId);
    const name: string = host.toLowerCase();
    if (
      descriptor === undefined ||
      !descriptor.resolve().available ||
      !this.servedHosts(descriptor).includes(name)
    ) {
      return null;
    }
    return { descriptor, host: name };
  }

  /**
   * Runs a read for a repository the renderer named, and maps the answer to a forge result.
   * @param repository The untrusted reference.
   * @param op The operation.
   * @param params Builds its parameters from the validated reference.
   * @returns Returns the result.
   */
  private async read<Op extends HostingOp>(
    repository: unknown,
    op: Op,
    params: (target: HostedRepositoryRef) => HostingParams<Op>,
  ): Promise<ForgeResult<HostingResult<Op>>> {
    const target: HostedRepositoryRef | null = asRepository(repository);
    if (target === null) {
      return { ok: false, error: 'No forge repository was named.', unauthorized: false };
    }
    return toResult(await this.host.request(op, params(target), USER));
  }

  /**
   * Re-runs or cancels a CI run the user chose, validating the run id first.
   * @param repository The untrusted reference.
   * @param runId The untrusted run id.
   * @param op Which command.
   * @returns Returns nothing on success, or why it failed.
   */
  private async runCommand(
    repository: unknown,
    runId: unknown,
    op: 'rerunCiRun' | 'cancelCiRun',
  ): Promise<ForgeResult<void>> {
    const target: HostedRepositoryRef | null = asRepository(repository);
    if (target === null) {
      return { ok: false, error: 'No forge repository was named.', unauthorized: false };
    }
    if (typeof runId !== 'string' || !/^\d+$/.test(runId)) {
      return { ok: false, error: 'Invalid workflow run.', unauthorized: false };
    }
    const result: ForgeResult<unknown> = toResult(
      await this.host.request(op, { repository: target, runId }, USER),
    );
    return result.ok ? { ok: true, value: undefined } : result;
  }
}

/**
 * Maps a hosting answer to the result a panel reads.
 * @param response The answer.
 * @returns Returns the result.
 */
function toResult<T>(response: HostingResponse): ForgeResult<T> {
  if (response.ok) {
    return { ok: true, value: response.result as T };
  }
  const retryAt: number =
    response.retryAt === undefined ? Number.NaN : Date.parse(response.retryAt);
  return {
    ok: false,
    error: response.error,
    unauthorized: response.code === 'unauthorized',
    ...(Number.isFinite(retryAt) ? { retryAt } : {}),
  };
}

/**
 * Validates a renderer-supplied issue number: anything that is not a positive whole number becomes
 * zero, which a host answers with a plain "not found".
 * @param value The value the renderer sent.
 * @returns Returns the number, or zero.
 */
export function asIssueNumber(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/**
 * Validates a renderer-supplied repository reference. The renderer is treated as hostile, so the
 * reference that addresses an outbound request is checked rather than trusted — an owner or name
 * carrying a slash would otherwise be able to redirect the path.
 * @param value The value the renderer sent.
 * @returns Returns the reference, or null when it is not one.
 */
export function asRepository(value: unknown): HostedRepositoryRef | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { host, owner, name } = value as Record<string, unknown>;
  if (
    typeof host !== 'string' ||
    typeof owner !== 'string' ||
    typeof name !== 'string' ||
    host.length === 0 ||
    owner.length === 0 ||
    name.length === 0 ||
    [host, owner, name].some((part: string): boolean => /[/\\?#]/.test(part))
  ) {
    return null;
  }
  return { host: host.toLowerCase(), owner, name };
}
