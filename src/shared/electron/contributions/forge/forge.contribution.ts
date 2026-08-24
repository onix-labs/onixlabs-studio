import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { ForgeChannel } from '@shared/api/forge-channels';
import {
  ForgeAuthStatus,
  ForgeIdentity,
  ForgeIssue,
  ForgePullRequest,
  ForgeRepositoryRef,
  ForgeResult,
  ForgeWorkflowRun,
} from '@shared/api/forge-types';
import { ContributionContext, MainContribution } from '../main-contribution';
import { detectForge } from './forge-detection';
import {
  ForgeCredentialStore,
  ForgeCredentialStorePorts,
  ResolvedToken,
} from './forge-credential-store';
import { ForgeFetch, ForgeProvider, ForgeResponse } from './forge-provider';
import { GitHubForge } from './github-forge';

/**
 * How long the `gh` CLI probe is given before it is abandoned. The CLI can block on a keychain prompt
 * or a slow network, and this runs on the path that renders the settings page.
 */
const GH_TIMEOUT_MS: number = 3_000;

/**
 * The host every operation is currently scoped to. Detection already resolves a host per repository,
 * and the store is keyed by host; this constant is only the default the settings page reads and writes,
 * until a self-hosted instance can be configured (which is what makes it a constant rather than an
 * inlined string).
 */
const DEFAULT_HOST: string = 'github.com';

/**
 * The forge contribution: the main-process half of the Repository panel's Pull Requests, Issues and
 * Actions sections (#432, epic #431).
 *
 * It owns the token, the network, and the provider seam. The renderer can ask for a token to be stored
 * or cleared and can read the resulting status, but the token itself never crosses the boundary — the
 * same rule the AI credential store follows, for the same reason.
 *
 * It declares no permissions: reaching an HTTPS API needs none of the brokered resources, and the
 * credential file lives in the app's own user-data directory.
 */
export class ForgeContribution implements MainContribution {
  /**
   * The stable contribution id and IPC channel namespace.
   */
  public readonly id: string = 'forge';

  /**
   * The credential store, built at activation because its blob lives under `app.getPath('userData')`,
   * which is only available once the app is ready — and this module is imported by the contributions
   * manifest long before that.
   */
  private store: ForgeCredentialStore | null = null;

  /**
   * The provider serving requests, once activated.
   */
  private provider: ForgeProvider | null = null;

  /**
   * Builds the credential store at activation. Injected so tests can supply in-memory ports.
   */
  private readonly storeFactory: () => ForgeCredentialStore;

  /**
   * Builds the provider at activation, given the token resolver. Injected so tests can supply a fake.
   */
  private readonly providerFactory: (token: () => string | null) => ForgeProvider;

  /**
   * Initializes a new instance of the {@link ForgeContribution} class.
   * @param store The credential store to use; when omitted, the production safe-storage-backed store is
   * built at activation.
   * @param provider The provider to serve; when omitted, the production GitHub provider is built at
   * activation.
   */
  public constructor(
    store?: ForgeCredentialStore,
    provider?: (token: () => string | null) => ForgeProvider,
  ) {
    this.storeFactory = store === undefined ? defaultStore : (): ForgeCredentialStore => store;
    this.providerFactory = provider ?? defaultProvider;
  }

  /**
   * Wires the detection, authentication and listing channels.
   * @param context The contribution context.
   */
  public activate(context: ContributionContext): void {
    const store: ForgeCredentialStore = this.storeFactory();
    this.store = store;
    // Resolved per request rather than captured, so a token pasted or cleared in settings takes effect
    // on the very next call without rebuilding the provider.
    this.provider = this.providerFactory((): string | null => store.resolve(DEFAULT_HOST).token);

    context.handle(
      ForgeChannel.Detect,
      (_event: IpcMainInvokeEvent, remoteUrl: unknown): ForgeRepositoryRef | null =>
        typeof remoteUrl === 'string' ? detectForge(remoteUrl) : null,
    );
    context.handle(ForgeChannel.AuthStatus, (): Promise<ForgeAuthStatus> => this.authStatus());
    context.handle(
      ForgeChannel.SetToken,
      (_event: IpcMainInvokeEvent, token: unknown): Promise<ForgeAuthStatus> => {
        store.setToken(DEFAULT_HOST, typeof token === 'string' ? token : '');
        context.log.info('stored a forge token');
        return this.authStatus();
      },
    );
    context.handle(ForgeChannel.ClearToken, (): Promise<ForgeAuthStatus> => {
      store.clearToken(DEFAULT_HOST);
      context.log.info('cleared the stored forge token');
      return this.authStatus();
    });

    context.handle(
      ForgeChannel.PullRequests,
      (
        _event: IpcMainInvokeEvent,
        repository: unknown,
      ): Promise<ForgeResult<readonly ForgePullRequest[]>> =>
        this.list(repository, (provider: ForgeProvider, target: ForgeRepositoryRef) =>
          provider.listPullRequests(target),
        ),
    );
    context.handle(
      ForgeChannel.Issues,
      (
        _event: IpcMainInvokeEvent,
        repository: unknown,
      ): Promise<ForgeResult<readonly ForgeIssue[]>> =>
        this.list(repository, (provider: ForgeProvider, target: ForgeRepositoryRef) =>
          provider.listIssues(target),
        ),
    );
    context.handle(
      ForgeChannel.WorkflowRuns,
      (
        _event: IpcMainInvokeEvent,
        repository: unknown,
      ): Promise<ForgeResult<readonly ForgeWorkflowRun[]>> =>
        this.list(repository, (provider: ForgeProvider, target: ForgeRepositoryRef) =>
          provider.listWorkflowRuns(target),
        ),
    );

    context.handle(
      ForgeChannel.RerunWorkflowRun,
      (
        _event: IpcMainInvokeEvent,
        repository: unknown,
        runId: unknown,
      ): Promise<ForgeResult<void>> =>
        this.run(repository, runId, (provider, target, id) =>
          provider.rerunWorkflowRun(target, id),
        ),
    );
    context.handle(
      ForgeChannel.CancelWorkflowRun,
      (
        _event: IpcMainInvokeEvent,
        repository: unknown,
        runId: unknown,
      ): Promise<ForgeResult<void>> =>
        this.run(repository, runId, (provider, target, id) =>
          provider.cancelWorkflowRun(target, id),
        ),
    );

    context.log.info('forge contribution active; serving github');
  }

  /**
   * Drops the provider and store. The IPC handlers are removed automatically by the registry.
   */
  public dispose(): void {
    this.provider = null;
    this.store = null;
  }

  /**
   * Reads the authentication status, verifying the resolved credential against the forge rather than
   * merely reporting that one exists — a stored-but-rejected token would otherwise read as signed in.
   * @returns Returns the status.
   */
  private async authStatus(): Promise<ForgeAuthStatus> {
    const store: ForgeCredentialStore | null = this.store;
    const provider: ForgeProvider | null = this.provider;
    if (store === null || provider === null) {
      return {
        source: 'none',
        authenticated: false,
        hasStoredToken: false,
        identity: null,
        detail: 'The forge backend is not available.',
      };
    }
    const hasStoredToken: boolean = store.hasStoredToken(DEFAULT_HOST);
    const resolved: ResolvedToken = store.resolve(DEFAULT_HOST);
    if (resolved.token === null) {
      return {
        source: 'none',
        authenticated: false,
        hasStoredToken,
        identity: null,
        detail:
          'Not signed in to GitHub. Paste a personal access token below, or sign in with the GitHub CLI (`gh auth login`).',
      };
    }
    const result: ForgeResult<ForgeIdentity> = await provider.identity();
    if (!result.ok) {
      return {
        source: resolved.source,
        authenticated: false,
        hasStoredToken,
        identity: null,
        detail: result.error,
      };
    }
    return {
      source: resolved.source,
      authenticated: true,
      hasStoredToken,
      identity: result.value,
      detail:
        resolved.source === 'gh-cli'
          ? `Signed in as ${result.value.login} using the GitHub CLI's login.`
          : `Signed in as ${result.value.login}.`,
    };
  }

  /**
   * Runs a workflow-run command, validating both the repository and the run id from the renderer
   * before either reaches the provider.
   * @param repository The reference the renderer sent, which is untrusted input.
   * @param runId The run id the renderer sent, likewise.
   * @param act The provider operation to run.
   * @returns Returns the operation's result, or the reason it could not run.
   */
  private async run(
    repository: unknown,
    runId: unknown,
    act: (
      provider: ForgeProvider,
      target: ForgeRepositoryRef,
      id: number,
    ) => Promise<ForgeResult<void>>,
  ): Promise<ForgeResult<void>> {
    const provider: ForgeProvider | null = this.provider;
    if (provider === null) {
      return { ok: false, error: 'The forge backend is not available.', unauthorized: false };
    }
    const target: ForgeRepositoryRef | null = asRepository(repository);
    if (target === null) {
      return { ok: false, error: 'No forge repository was named.', unauthorized: false };
    }
    if (typeof runId !== 'number' || !Number.isSafeInteger(runId) || runId <= 0) {
      return { ok: false, error: 'Invalid workflow run.', unauthorized: false };
    }
    return act(provider, target, runId);
  }

  /**
   * Runs a listing operation against a repository reference from the renderer, validating the shape
   * before it reaches the provider.
   * @param repository The reference the renderer sent, which is untrusted input.
   * @param read The provider operation to run.
   * @returns Returns the operation's result, or the reason it could not run.
   */
  private async list<T>(
    repository: unknown,
    read: (provider: ForgeProvider, target: ForgeRepositoryRef) => Promise<ForgeResult<T>>,
  ): Promise<ForgeResult<T>> {
    const provider: ForgeProvider | null = this.provider;
    if (provider === null) {
      return { ok: false, error: 'The forge backend is not available.', unauthorized: false };
    }
    const target: ForgeRepositoryRef | null = asRepository(repository);
    if (target === null) {
      return { ok: false, error: 'No forge repository was named.', unauthorized: false };
    }
    return read(provider, target);
  }
}

/**
 * Validates a renderer-supplied repository reference. The renderer is treated as hostile, so the
 * reference that addresses an outbound request is checked rather than trusted — an owner or name
 * carrying a slash would otherwise be able to redirect the path.
 * @param value The value the renderer sent.
 * @returns Returns the reference, or null when it is not one.
 */
export function asRepository(value: unknown): ForgeRepositoryRef | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate: Partial<ForgeRepositoryRef> = value;
  const { kind, host, owner, name } = candidate;
  if (kind !== 'github') {
    return null;
  }
  if (
    typeof host !== 'string' ||
    typeof owner !== 'string' ||
    typeof name !== 'string' ||
    host.length === 0 ||
    owner.length === 0 ||
    name.length === 0
  ) {
    return null;
  }
  if ([host, owner, name].some((part: string): boolean => /[/\\?#]/.test(part))) {
    return null;
  }
  return { kind, host, owner, name };
}

/**
 * Reads the token the `gh` CLI holds for a host.
 *
 * `gh auth token` is asked for its *resolved* token, which is the whole point of going through the CLI
 * rather than reading its config: it knows about hosts, enterprise instances and keychain storage. The
 * environment is scrubbed of `GITHUB_TOKEN` and `GH_TOKEN` first — gh prefers an environment token over
 * a real login and reports it as the answer even when it is stale, which is a common state on a
 * developer machine and would have Studio confidently authenticate as nobody.
 *
 * @param host The forge host.
 * @returns Returns the CLI's token, or null when the CLI is absent, not logged in, or too slow.
 */
export function readGhToken(host: string): string | null {
  try {
    const environment: NodeJS.ProcessEnv = { ...process.env };
    delete environment['GITHUB_TOKEN'];
    delete environment['GH_TOKEN'];
    const stdout: string = execFileSync('gh', ['auth', 'token', '--hostname', host], {
      encoding: 'utf8',
      timeout: GH_TIMEOUT_MS,
      env: environment,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const token: string = stdout.trim();
    return token.length === 0 ? null : token;
  } catch {
    // Not installed, not logged in, or timed out. All three mean the same thing here: no CLI token.
    return null;
  }
}

/**
 * Builds the production credential store: an encrypted blob in the app's user-data directory, beside
 * the AI credentials, with the `gh` CLI as the fallback probe.
 * @returns Returns the store.
 */
function defaultStore(): ForgeCredentialStore {
  const file: string = join(app.getPath('userData'), 'forge-credentials.bin');
  const ports: ForgeCredentialStorePorts = {
    load: (): string | null => {
      if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) {
        return null;
      }
      try {
        return safeStorage.decryptString(readFileSync(file));
      } catch {
        // A blob written under a different OS key (a restored machine, a changed keychain) cannot be
        // read back. Treated as no credential rather than a hard failure: the user pastes a new token.
        return null;
      }
    },
    save: (plaintext: string | null): void => {
      if (plaintext === null) {
        rmSync(file, { force: true });
        return;
      }
      if (!safeStorage.isEncryptionAvailable()) {
        // Refusing is deliberate: writing the token in plain text would be a worse outcome than the
        // user being unable to store one, and the status already explains a missing credential.
        return;
      }
      writeFileSync(file, safeStorage.encryptString(plaintext), { mode: 0o600 });
    },
    ghToken: readGhToken,
  };
  return new ForgeCredentialStore(ports);
}

/**
 * Builds the production provider: GitHub over the platform fetch.
 * @param token Resolves the credential to authenticate with.
 * @returns Returns the provider.
 */
function defaultProvider(token: () => string | null): ForgeProvider {
  // The platform Response is adapted rather than used directly: the seam asks for a header reader so
  // a provider never depends on the DOM Headers type, which is what keeps it testable with a fake.
  const http: ForgeFetch = async (
    url: string,
    init?: Parameters<ForgeFetch>[1],
  ): Promise<ForgeResponse> => {
    const response: Response = await fetch(url, init);
    return {
      ok: response.ok,
      status: response.status,
      json: (): Promise<unknown> => response.json(),
      header: (name: string): string | null => response.headers.get(name),
    };
  };
  return new GitHubForge(http, token);
}

/**
 * The singleton forge contribution appended to the `mainContributions` manifest.
 */
export const forgeContribution: MainContribution = new ForgeContribution();
