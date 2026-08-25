import { describe, expect, it } from 'vitest';
import { ForgeChannel } from '@shared/api/forge-channels';
import {
  ForgeAuthStatus,
  ForgeIdentity,
  ForgeIssue,
  ForgeIssueComment,
  ForgePullRequest,
  ForgeRepositoryRef,
  ForgeResult,
  ForgeWorkflowRun,
} from '@shared/api/forge-types';
import type { IpcMainInvokeEvent } from 'electron';
import {
  ContributionContext,
  ContributionListener,
  InvokeHandler,
  MainContribution,
} from '../main-contribution';
import { ForgeCredentialStore, ForgeCredentialStorePorts } from './forge-credential-store';
import { ForgeProvider } from './forge-provider';
import { asRepository, ForgeContribution } from './forge.contribution';

/**
 * The repository the listing channels are asked for.
 */
const REPOSITORY: ForgeRepositoryRef = {
  kind: 'github',
  host: 'github.com',
  owner: 'onix-labs',
  name: 'onixlabs-studio',
};

/**
 * A provider whose identity result is settable, so the auth states can be driven from a test.
 */
class FakeProvider implements ForgeProvider {
  public readonly kind: string = 'github';

  /**
   * Holds what {@link identity} resolves to.
   */
  public identityResult: ForgeResult<ForgeIdentity> = {
    ok: true,
    value: { login: 'matthew', name: null },
  };

  /**
   * Holds the repositories each listing operation was called with.
   */
  public readonly listed: ForgeRepositoryRef[] = [];

  public identity(): Promise<ForgeResult<ForgeIdentity>> {
    return Promise.resolve(this.identityResult);
  }

  public listPullRequests(
    repository: ForgeRepositoryRef,
  ): Promise<ForgeResult<readonly ForgePullRequest[]>> {
    this.listed.push(repository);
    return Promise.resolve({ ok: true, value: [] });
  }

  public listIssues(repository: ForgeRepositoryRef): Promise<ForgeResult<readonly ForgeIssue[]>> {
    this.listed.push(repository);
    return Promise.resolve({ ok: true, value: [] });
  }

  /**
   * Holds the issue numbers {@link listIssueComments} was asked for, so the number guard can be
   * exercised.
   */
  public readonly commentedOn: number[] = [];

  public listIssueComments(
    repository: ForgeRepositoryRef,
    issueNumber: number,
  ): Promise<ForgeResult<readonly ForgeIssueComment[]>> {
    this.listed.push(repository);
    this.commentedOn.push(issueNumber);
    return Promise.resolve({ ok: true, value: [] });
  }

  public listWorkflowRuns(
    repository: ForgeRepositoryRef,
  ): Promise<ForgeResult<readonly ForgeWorkflowRun[]>> {
    this.listed.push(repository);
    return Promise.resolve({ ok: true, value: [] });
  }

  /**
   * Holds the run commands issued, in order.
   */
  public readonly commands: string[] = [];

  public rerunWorkflowRun(
    repository: ForgeRepositoryRef,
    runId: number,
  ): Promise<ForgeResult<void>> {
    this.commands.push(`rerun:${repository.owner}/${repository.name}:${runId}`);
    return Promise.resolve({ ok: true, value: undefined });
  }

  public cancelWorkflowRun(
    repository: ForgeRepositoryRef,
    runId: number,
  ): Promise<ForgeResult<void>> {
    this.commands.push(`cancel:${repository.owner}/${repository.name}:${runId}`);
    return Promise.resolve({ ok: true, value: undefined });
  }
}

/**
 * An in-memory contribution context that records what was registered.
 */
class FakeContext {
  public readonly handlers: Map<string, InvokeHandler> = new Map<string, InvokeHandler>();
  public readonly listeners: Map<string, ContributionListener> = new Map<
    string,
    ContributionListener
  >();

  public readonly context: ContributionContext = {
    handle: (channel: string, handler: InvokeHandler): void => {
      this.handlers.set(channel, handler);
    },
    on: (channel: string, listener: ContributionListener): void => {
      this.listeners.set(channel, listener);
    },
    send: (): void => undefined,
    permission: <T>(): T => {
      throw new Error('no permissions declared');
    },
    mainWindow: (): null => null,
    log: { error: (): void => undefined, warn: (): void => undefined, info: (): void => undefined },
  };

  /**
   * Invokes a registered handler by channel.
   * @param channel The channel to invoke.
   * @param args The handler arguments.
   * @returns Returns the handler's reply.
   */
  public invoke(channel: string, ...args: unknown[]): unknown {
    const handler: InvokeHandler | undefined = this.handlers.get(channel);
    if (handler === undefined) {
      throw new Error(`No handler for ${channel}`);
    }
    return handler({} as IpcMainInvokeEvent, ...args);
  }
}

/**
 * In-memory credential ports.
 */
class FakePorts implements ForgeCredentialStorePorts {
  public blob: string | null = null;
  public cli: string | null = null;

  public load(): string | null {
    return this.blob;
  }

  public save(plaintext: string | null): void {
    this.blob = plaintext;
  }

  public ghToken(): string | null {
    return this.cli;
  }
}

/**
 * Activates a contribution over fakes.
 * @returns Returns the parts under test.
 */
function activate(): {
  fake: FakeContext;
  provider: FakeProvider;
  ports: FakePorts;
  contribution: ForgeContribution;
} {
  const ports: FakePorts = new FakePorts();
  const provider: FakeProvider = new FakeProvider();
  const contribution: ForgeContribution = new ForgeContribution(
    new ForgeCredentialStore(ports),
    (): ForgeProvider => provider,
  );
  const fake: FakeContext = new FakeContext();
  contribution.activate(fake.context);
  return { fake, provider, ports, contribution };
}

describe('asRepository', () => {
  it('acceptsAWellFormedReference', () => {
    expect(asRepository({ ...REPOSITORY })).toEqual(REPOSITORY);
  });

  it('rejectsAnythingThatIsNotAReference', () => {
    expect(asRepository(null)).toBeNull();
    expect(asRepository('github.com/onix-labs/studio')).toBeNull();
    expect(asRepository({})).toBeNull();
  });

  it('rejectsAnUnknownForgeKind', () => {
    expect(asRepository({ ...REPOSITORY, kind: 'gitlab' })).toBeNull();
  });

  it('rejectsEmptyParts', () => {
    expect(asRepository({ ...REPOSITORY, owner: '' })).toBeNull();
    expect(asRepository({ ...REPOSITORY, name: '' })).toBeNull();
    expect(asRepository({ ...REPOSITORY, host: '' })).toBeNull();
  });

  it('rejectsPathSeparatorsInAnyPart', () => {
    // The renderer is treated as hostile: an owner carrying a slash could otherwise redirect the
    // outbound request path to another endpoint entirely.
    expect(asRepository({ ...REPOSITORY, owner: '../../admin' })).toBeNull();
    expect(asRepository({ ...REPOSITORY, name: 'repo/../../other' })).toBeNull();
    expect(asRepository({ ...REPOSITORY, name: 'repo?x=1' })).toBeNull();
    expect(asRepository({ ...REPOSITORY, host: 'a\\b' })).toBeNull();
  });
});

describe('ForgeContribution', () => {
  it('registersEveryChannel', () => {
    const { fake } = activate();

    expect([...fake.handlers.keys()].sort()).toEqual(
      [
        ForgeChannel.AuthStatus,
        ForgeChannel.ClearToken,
        ForgeChannel.Detect,
        ForgeChannel.Issues,
        ForgeChannel.IssueComments,
        ForgeChannel.PullRequests,
        ForgeChannel.SetToken,
        ForgeChannel.WorkflowRuns,
        ForgeChannel.RerunWorkflowRun,
        ForgeChannel.CancelWorkflowRun,
      ].sort(),
    );
  });

  it('declaresNoPermissions', () => {
    // Reaching an HTTPS API needs none of the brokered resources.
    const { contribution } = activate();

    expect((contribution as MainContribution).permissions).toBeUndefined();
  });

  it('detect_resolvesARemoteUrl', () => {
    const { fake } = activate();

    expect(
      fake.invoke(ForgeChannel.Detect, 'git@github.com:onix-labs/onixlabs-studio.git'),
    ).toEqual(REPOSITORY);
  });

  it('detect_declinesANonStringArgument', () => {
    const { fake } = activate();

    expect(fake.invoke(ForgeChannel.Detect, 42)).toBeNull();
  });

  it('authStatus_reportsSignedOut_whenNoCredentialResolves', async () => {
    const { fake } = activate();

    const status: ForgeAuthStatus = (await fake.invoke(ForgeChannel.AuthStatus)) as ForgeAuthStatus;

    expect(status.authenticated).toBe(false);
    expect(status.source).toBe('none');
    expect(status.hasStoredToken).toBe(false);
    expect(status.detail).toContain('Not signed in');
  });

  it('authStatus_verifiesTheCredential_ratherThanTrustingThatOneExists', async () => {
    // A stored-but-rejected token would otherwise read as signed in.
    const { fake, provider } = activate();
    provider.identityResult = {
      ok: false,
      error: 'GitHub rejected the token.',
      unauthorized: true,
    };
    await fake.invoke(ForgeChannel.SetToken, 'ghp_expired');

    const status: ForgeAuthStatus = (await fake.invoke(ForgeChannel.AuthStatus)) as ForgeAuthStatus;

    expect(status.authenticated).toBe(false);
    expect(status.hasStoredToken).toBe(true);
    expect(status.detail).toBe('GitHub rejected the token.');
  });

  it('setToken_storesItAndReportsTheIdentity', async () => {
    const { fake, ports } = activate();

    const status: ForgeAuthStatus = (await fake.invoke(
      ForgeChannel.SetToken,
      'ghp_good',
    )) as ForgeAuthStatus;

    expect(status).toEqual({
      source: 'stored',
      authenticated: true,
      hasStoredToken: true,
      identity: { login: 'matthew', name: null },
      detail: 'Signed in as matthew.',
    });
    // Stored, and stored encrypted-at-rest by the production ports — never handed back.
    expect(ports.blob).toContain('ghp_good');
    expect(JSON.stringify(status)).not.toContain('ghp_good');
  });

  it('clearToken_signsOut_whenThereIsNoCliLogin', async () => {
    const { fake } = activate();
    await fake.invoke(ForgeChannel.SetToken, 'ghp_good');

    const status: ForgeAuthStatus = (await fake.invoke(ForgeChannel.ClearToken)) as ForgeAuthStatus;

    expect(status.authenticated).toBe(false);
    expect(status.hasStoredToken).toBe(false);
  });

  it('clearToken_leavesTheUserSignedIn_whenACliLoginRemains', async () => {
    // Clearing the stored token is not the same act as signing out, and the status says so.
    const { fake, ports } = activate();
    ports.cli = 'ghp_cli';
    await fake.invoke(ForgeChannel.SetToken, 'ghp_good');

    const status: ForgeAuthStatus = (await fake.invoke(ForgeChannel.ClearToken)) as ForgeAuthStatus;

    expect(status.authenticated).toBe(true);
    expect(status.source).toBe('gh-cli');
    expect(status.hasStoredToken).toBe(false);
    expect(status.detail).toContain('GitHub CLI');
  });

  it('listingChannels_reachTheProviderWithTheValidatedReference', async () => {
    const { fake, provider } = activate();

    await fake.invoke(ForgeChannel.PullRequests, { ...REPOSITORY });
    await fake.invoke(ForgeChannel.Issues, { ...REPOSITORY });
    await fake.invoke(ForgeChannel.WorkflowRuns, { ...REPOSITORY });

    expect(provider.listed).toEqual([REPOSITORY, REPOSITORY, REPOSITORY]);
  });

  it('listingChannels_refuseAMalformedReference_withoutReachingTheProvider', async () => {
    const { fake, provider } = activate();

    const result: ForgeResult<unknown> = (await fake.invoke(ForgeChannel.PullRequests, {
      ...REPOSITORY,
      owner: '../admin',
    })) as ForgeResult<unknown>;

    expect(result.ok).toBe(false);
    expect(provider.listed).toEqual([]);
  });

  it('runCommands_reachTheProviderWithTheValidatedReferenceAndId', async () => {
    const { fake, provider } = activate();

    await fake.invoke(ForgeChannel.RerunWorkflowRun, { ...REPOSITORY }, 99);
    await fake.invoke(ForgeChannel.CancelWorkflowRun, { ...REPOSITORY }, 99);

    expect(provider.commands).toEqual([
      'rerun:onix-labs/onixlabs-studio:99',
      'cancel:onix-labs/onixlabs-studio:99',
    ]);
  });

  it('runCommands_refuseAnIdThatIsNotAPositiveInteger', async () => {
    // The id addresses a mutating endpoint and arrives from the renderer, which is untrusted.
    const { fake, provider } = activate();

    for (const bad of ['99', -1, 0, 1.5, Number.NaN, null, undefined]) {
      const result: ForgeResult<void> = (await fake.invoke(
        ForgeChannel.RerunWorkflowRun,
        { ...REPOSITORY },
        bad,
      )) as ForgeResult<void>;
      expect(result.ok).toBe(false);
    }

    expect(provider.commands).toEqual([]);
  });

  it('afterDispose_theBackendReportsItselfUnavailable', async () => {
    const { fake, contribution } = activate();
    contribution.dispose();

    const status: ForgeAuthStatus = (await fake.invoke(ForgeChannel.AuthStatus)) as ForgeAuthStatus;
    const result: ForgeResult<unknown> = (await fake.invoke(ForgeChannel.PullRequests, {
      ...REPOSITORY,
    })) as ForgeResult<unknown>;

    expect(status.authenticated).toBe(false);
    expect(result.ok).toBe(false);
  });
});
