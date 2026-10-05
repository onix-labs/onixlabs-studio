import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { ForgeChannel } from '@shared/api/forge-channels';
import {
  ForgeAuthStatus,
  ForgeIssue,
  ForgeIssueComment,
  ForgePullRequest,
  ForgeRepositoryCapabilities,
  ForgeRepositoryRef,
  ForgeResult,
  ForgeTokenSource,
  ForgeWorkflowRun,
} from '@shared/api/forge-types';
import {
  HostedAuthStatus,
  HostedRepositoryRef,
  HostingOp,
  HostingParams,
  HostingResponse,
  HostingResult,
} from '@shared/api/hosting-protocol';
import { logger } from '../logger';
import { HostingCredentialStore } from './hosting-credential-store';
import { HostingDescriptor } from './hosting-descriptor';
import { HostedRepositoryDescription, HostingHost } from './hosting-host';
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
 * when it asks, and the renderer never sees it.
 */
export class HostingManager {
  /**
   * Initializes the manager.
   * @param host The hosting host.
   * @param store The token store.
   */
  public constructor(
    private readonly host: HostingHost,
    private readonly store: HostingCredentialStore,
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
    ipcMain.handle(ForgeChannel.AuthStatus, (): Promise<ForgeAuthStatus> => this.authStatus());
    ipcMain.handle(
      ForgeChannel.SetToken,
      (_event: IpcMainInvokeEvent, token: unknown): Promise<ForgeAuthStatus> =>
        this.setToken(typeof token === 'string' ? token : ''),
    );
    ipcMain.handle(ForgeChannel.ClearToken, (): Promise<ForgeAuthStatus> => this.setToken(''));
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
   * Reads how the plugin serving the default host is signed in to it.
   * @returns Returns the status.
   */
  public async authStatus(): Promise<ForgeAuthStatus> {
    const host: string | null = this.defaultHost();
    if (host === null) {
      return {
        source: 'none',
        authenticated: false,
        hasStoredToken: false,
        identity: null,
        detail: 'No hosting plugin is installed. Install GitHub from the Plugin Manager.',
      };
    }
    const hasStoredToken: boolean = this.store.hasStoredToken(host);
    const response: HostingResponse<'authStatus'> = await this.host.request(
      'authStatus',
      { host },
      USER,
    );
    if (!response.ok) {
      return {
        source: 'none',
        authenticated: false,
        hasStoredToken,
        identity: null,
        detail: response.error,
      };
    }
    const status: HostedAuthStatus = response.result;
    const source: ForgeTokenSource =
      status.mode === 'cli' ? 'gh-cli' : status.mode === 'studio' ? 'stored' : 'none';
    return {
      source,
      authenticated: status.authenticated,
      hasStoredToken,
      identity: status.identity,
      detail: status.detail,
    };
  }

  /**
   * Stores (or, given a blank token, clears) the token Studio keeps for the default host.
   * @param token The token.
   * @returns Returns the resulting status.
   */
  public async setToken(token: string): Promise<ForgeAuthStatus> {
    const host: string | null = this.defaultHost();
    if (host !== null) {
      this.store.setToken(host, token);
      logger.info(
        'HostingManager',
        `${token.trim().length > 0 ? 'Stored' : 'Cleared'} the ${host} token`,
      );
    }
    return this.authStatus();
  }

  /**
   * Gets the host the settings page signs in to: the first host of the highest-priority installed
   * hosting plugin. Core names no host itself.
   * @returns Returns the host, or null when no hosting plugin is installed.
   */
  private defaultHost(): string | null {
    const installed: HostingDescriptor | undefined = this.host
      .preferredOrder()
      .find((descriptor: HostingDescriptor): boolean => descriptor.resolve().available);
    return installed?.hosts[0] ?? null;
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
