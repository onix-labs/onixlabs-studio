import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AiChannel } from '@shared/api/ai-channels';
import type {
  AiConnection,
  AiDiscoverModelsResult,
  AiEvent,
  AiProviderInfo,
  AiSignInStatus,
} from '@shared/api/ai-types';
import type { BrowserWindow } from 'electron';
import type {
  AgentAuth,
  AgentModelReport,
  AgentProvider,
  AgentRunContext,
  AgentSession,
  ProviderAvailability,
} from './agent-provider';
import type { AgentProviderDescriptor, AgentProviderRegistry } from './agent-provider-registry';

/**
 * Describes an IPC handler as the fake `ipcMain` captures it.
 */
type Handler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * Holds the fake Electron layer: the invoke handlers and `on` listeners registered, every message the
 * window was sent, and the user-data directory it answers with.
 */
const electron: {
  handlers: Map<string, Handler>;
  listeners: Map<string, Handler>;
  sent: { channel: string; payload: unknown }[];
  userData: string;
} = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  listeners: new Map<string, Handler>(),
  sent: [],
  userData: '',
}));

vi.mock('electron', () => ({
  app: {
    getPath: (): string => electron.userData,
    getVersion: (): string => '0.0.0',
    isPackaged: false,
  },
  ipcMain: {
    handle: (channel: string, handler: Handler): void =>
      void electron.handlers.set(channel, handler),
    on: (channel: string, listener: Handler): void =>
      void electron.listeners.set(channel, listener),
  },
  safeStorage: {
    isEncryptionAvailable: (): boolean => true,
    encryptString: (text: string): Buffer => Buffer.from(text),
    decryptString: (bytes: Buffer): string => bytes.toString(),
  },
}));

const { AiManager } = await import('./ai-manager');

/**
 * The harness id every fake connection names.
 */
const FAKE_HARNESS: string = 'test.fake-harness';

/**
 * A promise settled from outside, for holding a fake provider part-way through a turn.
 */
class Deferred<T> {
  public resolve: (value: T) => void = (): void => undefined;
  public reject: (reason: unknown) => void = (): void => undefined;
  public readonly promise: Promise<T> = new Promise<T>(
    (resolve: (value: T) => void, reject: (reason: unknown) => void): void => {
      this.resolve = resolve;
      this.reject = reject;
    },
  );
}

/**
 * A live session recording what was done to it. Each turn runs {@link FakeSession.onTurn}.
 */
class FakeSession implements AgentSession {
  public readonly id: string = 'fake-session';
  public alive: boolean = true;
  public closed: number = 0;
  public interrupted: number = 0;
  public readonly turns: AgentRunContext[] = [];
  public readonly stoppedTasks: string[] = [];
  public readonly remoteControl: string[] = [];
  public onTurn: (context: AgentRunContext) => Promise<void> = (): Promise<void> =>
    Promise.resolve();
  public closeResult: () => Promise<void> = (): Promise<void> => Promise.resolve();
  public ended: ((reason: string) => void) | undefined;

  public turn(context: AgentRunContext): Promise<void> {
    this.turns.push(context);
    return this.onTurn(context);
  }

  public interrupt(): void {
    this.interrupted += 1;
  }

  public stopTask(taskId: string): void {
    this.stoppedTasks.push(taskId);
  }

  public setRemoteControl(mode: string): void {
    this.remoteControl.push(mode);
  }

  public onEnded(listener: (reason: string) => void): void {
    this.ended = listener;
  }

  public close(): Promise<void> {
    this.closed += 1;
    this.alive = false;
    return this.closeResult();
  }
}

/**
 * Describes the settable parts of a {@link FakeProvider}.
 */
interface FakeProviderOptions {
  live?: boolean;
  images?: boolean;
  remoteControl?: boolean;
  signIn?: boolean;
}

/**
 * A provider recording every run and session, whose behaviour each test sets.
 */
class FakeProvider implements AgentProvider {
  public readonly label: string = 'Fake';
  public readonly models: readonly { id: string; label: string }[] = [
    { id: 'fake-1', label: 'Fake 1' },
    { id: 'fake-2', label: 'Fake 2' },
  ];
  public readonly defaultModelId: string = 'fake-1';
  public readonly supportsImages: boolean;
  public readonly supportedEfforts: readonly ('low' | 'high')[] = ['low'];
  public readonly supportsRemoteControl: boolean;
  public readonly sessionModel: 'stateless' | 'live-harness';
  public readonly offersSignIn: boolean;
  public readonly contexts: AgentRunContext[] = [];
  public readonly sessions: FakeSession[] = [];
  public readonly reportedAuth: AgentAuth[] = [];
  public readonly reportedSettings: unknown[] = [];
  public onRun: (context: AgentRunContext) => Promise<void> = (): Promise<void> =>
    Promise.resolve();
  public onOpen: () => FakeSession = (): FakeSession => new FakeSession();
  public report: () => Promise<AgentModelReport | null> = (): Promise<AgentModelReport | null> =>
    Promise.resolve({ models: [], detail: null });

  public constructor(
    public readonly id: string,
    options: FakeProviderOptions = {},
  ) {
    this.supportsImages = options.images === true;
    this.supportsRemoteControl = options.remoteControl === true;
    this.offersSignIn = options.signIn === true;
    this.sessionModel = options.live === true ? 'live-harness' : 'stateless';
  }

  public describeAvailability(auth: AgentAuth): ProviderAvailability {
    return { available: auth.apiKey !== null, detail: 'fake availability' };
  }

  public run(context: AgentRunContext): Promise<void> {
    this.contexts.push(context);
    return this.onRun(context);
  }

  public openSession(context: AgentRunContext): AgentSession {
    this.contexts.push(context);
    const session: FakeSession = this.onOpen();
    this.sessions.push(session);
    return session;
  }

  public discoverModels(
    auth: AgentAuth,
    settings?: Readonly<Record<string, unknown>>,
  ): Promise<AgentModelReport | null> {
    this.reportedAuth.push(auth);
    this.reportedSettings.push(settings);
    return this.report();
  }
}

/**
 * Builds a connection naming the fake harness.
 * @param id The connection id.
 * @param overrides The fields to change.
 * @returns Returns the connection.
 */
function connection(id: string = 'conn', overrides: Partial<AiConnection> = {}): AiConnection {
  return {
    id,
    label: id,
    kind: 'openai-compatible',
    auth: 'api-key',
    models: [{ id: 'fake-1', label: 'Fake 1' }],
    defaultModelId: 'fake-1',
    harnessId: FAKE_HARNESS,
    ...overrides,
  };
}

/**
 * Lets every promise already queued settle. Timers are not advanced.
 * @returns Returns a promise resolving once the queue has drained.
 */
function settled(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => void setImmediate(resolve));
}

describe('AiManager', () => {
  let pluginData: string;
  let userData: string;
  let root: string;
  let manager: InstanceType<typeof AiManager>;
  let provider: FakeProvider;
  let offerSkills: () => Promise<readonly never[]>;
  let windowOpen: boolean;

  /**
   * Invokes a captured `ipcMain.handle` handler.
   * @param channel The channel.
   * @param args The renderer-supplied arguments.
   * @returns Returns what it answered.
   */
  async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    const handler: Handler | undefined = electron.handlers.get(channel);
    if (handler === undefined) {
      throw new Error(`Nothing handles ${channel}`);
    }
    return (await handler({ sender: {} }, ...args)) as T;
  }

  /**
   * Fires a captured `ipcMain.on` listener.
   * @param channel The channel.
   * @param payload The renderer-supplied payload.
   */
  function reply(channel: string, payload: unknown): void {
    electron.listeners.get(channel)?.({ sender: {} }, payload);
  }

  /**
   * Lists the agent events the window has been sent.
   * @returns Returns the events.
   */
  function events(): readonly AiEvent[] {
    return electron.sent
      .filter((message): boolean => message.channel === String(AiChannel.Event))
      .map((message): AiEvent => message.payload as AiEvent);
  }

  /**
   * Finds the agent events of one kind.
   * @param kind The kind.
   * @returns Returns the events, loosely typed so a test can read any of their fields.
   */
  function eventsOf(kind: string): readonly Record<string, unknown>[] {
    return events()
      .filter((event: AiEvent): boolean => event.kind === kind)
      .map((event: AiEvent): Record<string, unknown> => event as never);
  }

  /**
   * Lists the states the run has reported.
   * @param requestId The run.
   * @returns Returns the states, oldest first.
   */
  function statesOf(requestId: string = 'r1'): readonly unknown[] {
    return eventsOf('status')
      .filter((event: Record<string, unknown>): boolean => event['requestId'] === requestId)
      .map((event: Record<string, unknown>): unknown => event['state']);
  }

  /**
   * Starts a run and lets it reach the provider.
   * @param overrides The request fields to change.
   * @returns Returns a promise resolving once the run has started.
   */
  async function run(overrides: Record<string, unknown> = {}): Promise<void> {
    await invoke(AiChannel.Run, {
      requestId: 'r1',
      providerId: 'conn',
      model: 'fake-1',
      prompt: 'hello',
      workspaceRoot: root,
      permissionPosture: 'prompt',
      ...overrides,
    });
    await settled();
  }

  /**
   * Builds a manager with the fake harness registered, as a contributed plugin would be.
   * @returns Returns the manager.
   */
  function buildManager(): InstanceType<typeof AiManager> {
    const built: InstanceType<typeof AiManager> = new AiManager(
      (): BrowserWindow | null =>
        windowOpen
          ? ({
              webContents: {
                isDestroyed: (): boolean => false,
                once: (): void => undefined,
                removeListener: (): void => undefined,
                send: (channel: string, payload: unknown): void =>
                  void electron.sent.push({ channel, payload }),
              },
              isDestroyed: (): boolean => false,
            } as unknown as BrowserWindow)
          : null,
      { offer: (): Promise<readonly never[]> => offerSkills() },
      { isWithin: (target: unknown): boolean => target === root },
    );
    const harnesses: AgentProviderRegistry = Reflect.get(
      built,
      'harnesses',
    ) as AgentProviderRegistry;
    const descriptor: AgentProviderDescriptor = {
      id: FAKE_HARNESS,
      serves: (candidate: AiConnection): boolean => candidate.harnessId === FAKE_HARNESS,
      create: (): AgentProvider => provider,
    };
    harnesses.register(descriptor);
    built.register();
    return built;
  }

  beforeAll(() => {
    // The plugin scan happens once per launch, so the sideloaded harness goes in before anything reads
    // the user-data directory. The per-test directory takes over from here.
    pluginData = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-manager-plugins-')));
    const plugin: string = path.join(pluginData, 'plugins', 'test.env-harness');
    fs.mkdirSync(plugin, { recursive: true });
    const echo: string = path.join(
      process.cwd(),
      'src/shared/electron/ai/testing/echo-harness.mjs',
    );
    expect(fs.existsSync(echo)).toBe(true);
    // Records what the process was really started with, then behaves as the reference harness.
    fs.writeFileSync(
      path.join(plugin, 'main.mjs'),
      [
        "import { writeFileSync } from 'node:fs';",
        "writeFileSync(new URL('./spawned.json', import.meta.url), JSON.stringify({",
        '  runAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null,',
        '}));',
        `await import(${JSON.stringify(`file://${echo}`)});`,
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(plugin, 'plugin.json'),
      JSON.stringify({
        id: 'test.env-harness',
        name: 'Env harness',
        description: 'A harness recording how it was started.',
        version: '1.0.0',
        apiVersion: '1.12.0',
        provision: {
          kind: 'npm',
          lockfileUrl: 'https://example.invalid/lockfiles/lock.json',
          sha256: '0'.repeat(64),
          executablePath: 'main.mjs',
        },
        contributes: {
          agentHarnesses: [
            {
              id: 'test.env-harness',
              displayName: 'Env harness',
              priority: 100,
              connectionAuths: ['none'],
              command: { kind: 'node' },
              entryPoint: 'main.mjs',
            },
          ],
        },
      }),
    );
    electron.userData = pluginData;
    root = pluginData;
    offerSkills = (): Promise<readonly never[]> => Promise.resolve([]);
    provider = new FakeProvider('conn');
    windowOpen = true;
    buildManager().disposeAll();
  });

  afterAll(() => {
    fs.rmSync(pluginData, { recursive: true, force: true });
  });

  beforeEach(() => {
    userData = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-manager-')));
    electron.userData = userData;
    root = path.join(userData, 'workspace');
    electron.handlers.clear();
    electron.listeners.clear();
    electron.sent = [];
    windowOpen = true;
    offerSkills = (): Promise<readonly never[]> => Promise.resolve([]);
    provider = new FakeProvider('conn');
    manager = buildManager();
  });

  afterEach(() => {
    manager.disposeAll();
    vi.useRealTimers();
    fs.rmSync(userData, { recursive: true, force: true });
  });

  describe('routing on the connection a request carries (#701)', () => {
    it('discover_forAConnectionNeverListed_reachesItsHarness', async () => {
      provider.report = (): Promise<AgentModelReport> =>
        Promise.resolve({ models: [{ id: 'new' }], detail: null });

      const result: AiDiscoverModelsResult = await invoke(AiChannel.DiscoverModels, {
        connection: connection('unsaved'),
      });

      expect(result.ok).toBe(true);
      expect(result.models.map((model): string => model.id)).toEqual(['fake-1', 'new']);
      expect(result.added).toBe(1);
    });

    it('discover_forAConnectionNeverListed_usesItsOwnStoredKey', async () => {
      await invoke(AiChannel.SetConnectionKey, {
        connectionId: 'unlisted',
        authKind: 'api-key',
        key: 'stored-key',
      });

      await invoke(AiChannel.DiscoverModels, { connection: connection('unlisted') });

      expect(provider.reportedAuth[0]?.apiKey).toBe('stored-key');
    });

    it('discover_withTheAuthKindJustEdited_resolvesUnderThatKind', async () => {
      await invoke(AiChannel.ListProviders, [connection('edited', { auth: 'none' })]);
      await invoke(AiChannel.SetConnectionKey, {
        connectionId: 'edited',
        authKind: 'api-key',
        key: 'stored-key',
      });

      await invoke(AiChannel.DiscoverModels, {
        connection: connection('edited', { auth: 'api-key' }),
      });

      expect(provider.reportedAuth[0]?.apiKey).toBe('stored-key');
    });

    it('discover_withNoHarness_namesThePluginManager_andKeepsTheModels', async () => {
      const unserved: AiConnection = connection('plain', { harnessId: null });

      const result: AiDiscoverModelsResult = await invoke(AiChannel.DiscoverModels, {
        connection: unserved,
      });

      expect(result).toMatchObject({ ok: false, models: unserved.models, added: 0 });
      expect(result.detail).toContain('Install one in Plugins');
    });

    it.each([[undefined], [null], ['x'], [{}], [{ connection: {} }], [{ connection: 'x' }]])(
      'discover_withAMalformedRequest_answersInsteadOfThrowing %#',
      async (request: unknown) => {
        expect(await invoke(AiChannel.DiscoverModels, request)).toEqual({
          ok: false,
          models: [],
          added: 0,
          detail: 'Invalid discovery request.',
        });
      },
    );

    it('discover_whenTheHarnessCannotBeAsked_saysSo_andKeepsTheModels', async () => {
      provider.report = (): Promise<null> => Promise.resolve(null);

      const result: AiDiscoverModelsResult = await invoke(AiChannel.DiscoverModels, {
        connection: connection(),
      });

      expect(result.ok).toBe(false);
      expect(result.models).toEqual(connection().models);
      expect(result.detail).toBe('Fake could not be asked for its models.');
    });

    it('discover_withAnEmptyReport_prefersTheHarnesssOwnReason', async () => {
      provider.report = (): Promise<AgentModelReport> =>
        Promise.resolve({ models: [], detail: 'Could not reach Ollama' });

      const result: AiDiscoverModelsResult = await invoke(AiChannel.DiscoverModels, {
        connection: connection(),
      });

      expect(result).toMatchObject({ ok: false, detail: 'Could not reach Ollama' });
    });

    it('discover_withAnEmptyReportAndNoReason_saysToAddThemManually', async () => {
      const result: AiDiscoverModelsResult = await invoke(AiChannel.DiscoverModels, {
        connection: connection(),
      });

      expect(result.detail).toBe('Fake reported no models. Add models manually.');
    });

    it('discover_whenNothingIsNew_saysSo', async () => {
      provider.report = (): Promise<AgentModelReport> =>
        Promise.resolve({ models: [{ id: 'fake-1' }], detail: 'ignored' });

      const result: AiDiscoverModelsResult = await invoke(AiChannel.DiscoverModels, {
        connection: connection(),
      });

      expect(result).toMatchObject({
        ok: true,
        added: 0,
        detail: 'Fake reported 1 model(s); none were new.',
      });
    });

    it('discover_whenTheHarnessThrows_answersRatherThanRejecting', async () => {
      provider.report = (): Promise<never> => Promise.reject(new Error('harness fell over'));

      const result: AiDiscoverModelsResult = await invoke(AiChannel.DiscoverModels, {
        connection: connection(),
      });

      expect(result).toMatchObject({ ok: false, models: connection().models, added: 0 });
      expect(result.detail).toContain('harness fell over');
    });

    it('discover_carriesASanitisedExecutableChoiceToTheHarness', async () => {
      await invoke(AiChannel.DiscoverModels, {
        connection: connection(),
        claudeExecutable: { mode: 'nonsense' },
      });

      expect(provider.reportedSettings[0]).toMatchObject({
        claudeExecutable: { mode: 'bundled' },
      });
    });

    it('signIn_routesOnTheConnectionCarried_notTheCache', async () => {
      Reflect.set(provider, 'signIn', () => ({
        result: Promise.resolve({ signedIn: true, method: 'login', account: null }),
        cancel: (): void => undefined,
      }));

      const answer: AiSignInStatus = await invoke(AiChannel.CheckSignIn, {
        connection: connection('unsaved'),
      });

      expect(answer.supported).toBe(true);
      expect(await invoke(AiChannel.CheckSignIn, { connection: 'x' })).toEqual({
        supported: false,
        signedIn: false,
      });
    });

    it('startSignIn_withNothingToRunIt_reportsTheErrorToTheWindow', async () => {
      await invoke(AiChannel.StartSignIn, { connection: connection('x', { harnessId: null }) });

      expect(electron.sent).toContainEqual({
        channel: AiChannel.SignInProgress,
        payload: { phase: 'error', message: 'No agent plugin runs this configuration.' },
      });
    });

    it('signOut_withNothingToRunIt_isANoOp', async () => {
      await expect(invoke(AiChannel.SignOut, null)).resolves.toBeUndefined();
    });
  });

  describe('harness availability is never memoized (#698)', () => {
    it('listProviders_asksAfresh_soAHarnessInstalledLaterRunsWithoutARestart', async () => {
      const harnesses: AgentProviderRegistry = Reflect.get(
        manager,
        'harnesses',
      ) as AgentProviderRegistry;
      let installed: boolean = false;
      harnesses.register({
        id: 'test.late',
        serves: (candidate: AiConnection): boolean =>
          candidate.harnessId === 'test.late' && installed,
        create: (): AgentProvider => provider,
      });
      const late: AiConnection = connection('late', { harnessId: 'test.late' });

      expect(await invoke(AiChannel.ListProviders, [late])).toEqual([]);

      installed = true;

      const listed: readonly AiProviderInfo[] = await invoke(AiChannel.ListProviders, [late]);
      expect(listed.map((info: AiProviderInfo): string => info.id)).toEqual(['late']);
    });

    it('listProviders_afterAHarnessGoes_stopsOfferingIt', async () => {
      await invoke(AiChannel.ListProviders, [connection()]);

      const listed: readonly AiProviderInfo[] = await invoke(AiChannel.ListProviders, [
        connection('conn', { harnessId: 'test.gone' }),
      ]);

      expect(listed).toEqual([]);
      await run();
      expect(eventsOf('status')[0]?.['detail']).toContain('No AI provider is installed');
    });

    it.each([[undefined], [null], ['x'], [[{ id: 7 }]], [[null]]])(
      'listProviders_withAMalformedPayload_buildsNothing %#',
      async (payload: unknown) => {
        expect(await invoke(AiChannel.ListProviders, payload)).toEqual([]);
      },
    );

    it('listProviders_describesEachConnection', async () => {
      const listed: readonly AiProviderInfo[] = await invoke(AiChannel.ListProviders, [
        connection('a'),
      ]);

      expect(listed).toEqual([
        expect.objectContaining({
          id: 'a',
          label: 'Fake',
          available: false,
          detail: 'fake availability',
          defaultModelId: 'fake-1',
          supportsSignIn: false,
        }),
      ]);
    });

    it.each([
      ['api-key', false],
      ['none', false],
      ['claude-login', true],
      ['codex-login', true],
    ])('listProviders_offersSignInOnlyToLoginKinds %s', async (auth: string, offered: boolean) => {
      provider = new FakeProvider('conn', { signIn: true });

      const listed: readonly AiProviderInfo[] = await invoke(AiChannel.ListProviders, [
        connection('a', { auth: auth }),
      ]);

      expect(listed[0]?.supportsSignIn).toBe(offered);
    });
  });

  describe('a real harness process (#700)', () => {
    let spawned: string;

    /**
     * Lists the harness connection and waits for a run through it to reach a terminal state.
     * @param prompt The prompt, which decides what the reference harness does.
     * @returns Returns a promise resolving when the run has finished.
     */
    async function runThroughHarness(prompt: string): Promise<void> {
      await invoke(AiChannel.ListProviders, [
        connection('real', { harnessId: 'test.env-harness', auth: 'none' }),
      ]);
      await run({ providerId: 'real', prompt, workspaceRoot: null });
      await vi.waitFor(
        (): void => {
          expect(statesOf().at(-1)).toMatch(/completed|error|aborted/);
        },
        { timeout: 15_000, interval: 25 },
      );
    }

    beforeEach(() => {
      spawned = path.join(pluginData, 'plugins', 'test.env-harness', 'spawned.json');
      fs.rmSync(spawned, { force: true });
      // A session hosted by Studio inherits this variable, which would prove nothing: the harness has
      // to get it from the spawn spec.
      vi.stubEnv('ELECTRON_RUN_AS_NODE', undefined);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('spawn_carriesTheWholeSpec_soTheHarnessRunsAsNodeAndNotASecondStudio', async () => {
      await runThroughHarness('hello');

      expect(statesOf().at(-1)).toBe('completed');
      expect(JSON.parse(fs.readFileSync(spawned, 'utf8'))).toEqual({ runAsNode: '1' });
    }, 20_000);

    it('run_streamsTheHarnesssAnswerToTheWindow', async () => {
      await runThroughHarness('hello');

      expect(
        eventsOf('text')
          .map((event: Record<string, unknown>): unknown => event['delta'])
          .join(''),
      ).toContain('hello');
    }, 20_000);

    it('run_whenTheHarnessFailsTheTurn_landsAsAnError', async () => {
      await runThroughHarness('fail');

      expect(statesOf().at(-1)).toBe('error');
    }, 20_000);
  });

  describe('run admission', () => {
    beforeEach(async () => {
      await invoke(AiChannel.ListProviders, [connection()]);
    });

    it.each([
      [undefined],
      [null],
      ['run'],
      [{ requestId: 7, providerId: 'conn', prompt: 'x', workspaceRoot: null }],
      [{ requestId: 'r', providerId: 'conn', prompt: 7, workspaceRoot: null }],
      [{ requestId: 'r', providerId: 'conn', prompt: 'x' }],
      [{ requestId: 'r', providerId: 'conn', prompt: 'x', workspaceRoot: null, surface: 'nope' }],
      [{ requestId: 'r', providerId: 'conn', prompt: 'x', workspaceRoot: null, mode: 'god' }],
      [{ requestId: 'r', providerId: 'conn', prompt: 'x', workspaceRoot: null, images: 'x' }],
      [{ requestId: 'r', providerId: 'conn', prompt: 'x', workspaceRoot: null, runTimeoutMs: '1' }],
    ])('run_withAMalformedRequest_startsNothing %#', async (request: unknown) => {
      await invoke(AiChannel.Run, request);
      await settled();

      expect(provider.contexts).toEqual([]);
      expect(events()).toEqual([]);
    });

    it.each([
      ['a closed folder', '/not/open'],
      ['a relative path', 'workspace'],
      ['an empty path', ''],
    ])('run_inARootThatIs %s_isRefused', async (_label: string, workspaceRoot: string) => {
      await run({ workspaceRoot });

      expect(provider.contexts).toEqual([]);
      expect(eventsOf('status')[0]).toMatchObject({ state: 'error' });
      expect(eventsOf('status')[0]?.['detail']).toContain("isn't an open workspace");
    });

    it('run_withNoRoot_isAllowed', async () => {
      await run({ workspaceRoot: null });

      expect(provider.contexts).toHaveLength(1);
    });

    it('run_ofAConnectionNotListed_namesIt', async () => {
      await run({ providerId: 'other' });

      expect(eventsOf('status')[0]?.['detail']).toBe('Unknown provider: other');
    });

    it('run_withNothingInstalled_pointsAtThePluginManager', async () => {
      await invoke(AiChannel.ListProviders, []);

      await run();

      expect(eventsOf('status')[0]?.['detail']).toContain('Plugin Manager');
    });

    it('run_reportsStartedThenCompleted', async () => {
      await run();

      expect(statesOf()).toEqual(['started', 'completed']);
    });

    it('run_thatRejects_landsAsAnError_withItsMessage', async () => {
      provider.onRun = (): Promise<void> => Promise.reject(new Error('model refused'));

      await run();

      expect(statesOf()).toEqual(['started', 'error']);
      expect(eventsOf('status').at(-1)?.['detail']).toBe('model refused');
    });

    it('run_whoseProviderThrowsSynchronously_landsAsAnError', async () => {
      provider.onRun = (): Promise<void> => {
        throw new Error('not even started');
      };

      await run();

      expect(statesOf().at(-1)).toBe('error');
      expect(eventsOf('status').at(-1)?.['detail']).toBe('not even started');
    });

    it('run_whenTheSkillLibraryFails_landsAsAnError', async () => {
      offerSkills = (): Promise<never> => Promise.reject(new Error('library unreadable'));

      await run();

      expect(statesOf().at(-1)).toBe('error');
      expect(eventsOf('status').at(-1)?.['detail']).toBe('library unreadable');
    });

    it('run_stoppedWhileItsSkillsAreStillLoading_neverReachesTheProvider', async () => {
      const skills: Deferred<readonly never[]> = new Deferred<readonly never[]>();
      offerSkills = (): Promise<readonly never[]> => skills.promise;

      await run();
      await invoke(AiChannel.Abort, 'r1');
      skills.resolve([]);
      await settled();

      expect(provider.contexts).toEqual([]);
      expect(statesOf().at(-1)).toBe('aborted');
    });

    it('abort_landsTheRunAsAborted_notCompleted', async () => {
      const held: Deferred<void> = new Deferred<void>();
      provider.onRun = async (context: AgentRunContext): Promise<void> => {
        context.signal.addEventListener('abort', (): void => held.resolve());
        await held.promise;
      };
      await run();

      await invoke(AiChannel.Abort, 'r1');
      await settled();

      expect(statesOf()).toEqual(['started', 'aborted']);
    });

    it.each([[undefined], [7], ['someone-elses-run']])(
      'abort_ofNothingRunning_isANoOp %#',
      async (requestId: unknown) => {
        await expect(invoke(AiChannel.Abort, requestId)).resolves.toBeUndefined();
      },
    );

    it('run_withTheWindowClosed_doesNotThrow', async () => {
      windowOpen = false;

      await expect(run()).resolves.toBeUndefined();

      expect(provider.contexts).toHaveLength(1);
    });
  });

  describe('run context', () => {
    /**
     * Starts a run and answers the context it reached the provider with.
     * @param overrides The request fields to change.
     * @returns Returns the context.
     */
    async function contextOf(overrides: Record<string, unknown> = {}): Promise<AgentRunContext> {
      await invoke(AiChannel.ListProviders, [connection()]);
      await run(overrides);
      const context: AgentRunContext | undefined = provider.contexts.at(-1);
      if (context === undefined) {
        throw new Error('The run never reached the provider');
      }
      return context;
    }

    it('userData_isAlwaysDeniedToWrites_whateverTheRequestAsks', async () => {
      const context: AgentRunContext = await contextOf({
        deniedWritePaths: ['.env', 42],
        allowedWritePaths: [userData],
      });

      expect(context.deniedWritePaths).toEqual(['.env', userData]);
    });

    it('allowedWritePaths_dropsRelativeEntries', async () => {
      const context: AgentRunContext = await contextOf({
        allowedWritePaths: ['relative', '/abs', 7],
      });

      expect(context.allowedWritePaths).toEqual(['/abs']);
    });

    it('model_thatIsUnknown_fallsBackToTheDefault', async () => {
      expect((await contextOf({ model: 'stale' })).model).toBe('fake-1');
    });

    it('model_thatIsOffered_isHonoured', async () => {
      expect((await contextOf({ model: 'fake-2' })).model).toBe('fake-2');
    });

    it('posture_thatIsUnknown_fallsBackToPrompting', async () => {
      expect((await contextOf({ permissionPosture: 'god-mode' })).permissionPosture).toBe('prompt');
    });

    it.each([
      [100.7, 100],
      [0, 0],
      [-5, 0],
      ['9', 0],
    ])('tokenCap %s_clampsTo %s', async (tokenCap: unknown, expected: number) => {
      expect((await contextOf({ tokenCap })).tokenCap).toBe(expected);
    });

    it.each([
      [0, 0],
      [3.9, 3],
      [-1, 16],
      [Number.POSITIVE_INFINITY, 16],
      ['3', 16],
    ])('maxSteps %s_becomes %s', async (maxSteps: unknown, expected: number) => {
      expect((await contextOf({ maxSteps })).maxSteps).toBe(expected);
    });

    it('sandbox_isRequiredUnlessExplicitlyTurnedOff', async () => {
      expect((await contextOf()).requireSandbox).toBe(true);
      expect((await contextOf({ requireSandbox: false })).requireSandbox).toBe(false);
    });

    it('autoAllow_isOffUnlessExplicitlyTurnedOn', async () => {
      expect((await contextOf()).autoAllowSandboxedShell).toBe(false);
    });

    it('effort_theProviderDoesNotOffer_isDropped', async () => {
      expect((await contextOf({ effort: 'high' })).effort).toBeNull();
      expect((await contextOf({ effort: 'low' })).effort).toBe('low');
    });

    it('remoteControl_withoutProviderSupport_isOff', async () => {
      expect((await contextOf({ remoteControl: 'control' })).remoteControl).toBe('off');
    });

    it('remoteControl_withProviderSupport_isHonoured_butOnlyForKnownModes', async () => {
      provider = new FakeProvider('conn', { remoteControl: true });

      expect((await contextOf({ remoteControl: 'mirror' })).remoteControl).toBe('mirror');
      expect((await contextOf({ remoteControl: 'admin' })).remoteControl).toBe('off');
    });

    it('images_onlyReachAProviderThatTakesThem', async () => {
      const images: unknown = [{ mediaType: 'image/png', data: 'aGk=' }];

      expect((await contextOf({ images })).images).toEqual([]);

      provider = new FakeProvider('conn', { images: true });

      expect((await contextOf({ images })).images).toEqual(images);
    });

    it('images_keepOnlyWellFormedEntries_upToTheCap', async () => {
      provider = new FakeProvider('conn', { images: true });
      const good: unknown = { mediaType: 'image/png', data: 'aGk=' };

      const context: AgentRunContext = await contextOf({
        images: [
          { mediaType: 'image/svg+xml', data: 'aGk=' },
          { mediaType: 'image/png', data: 'not base64!' },
          { mediaType: 'image/png', data: '' },
          { mediaType: 'image/png', data: 'aGk=', name: 7 },
          null,
          ...new Array<unknown>(20).fill(good),
        ],
      });

      expect(context.images).toHaveLength(16);
    });

    it('contextPaths_dropMalformedEntries_andStrayContent', async () => {
      const context: AgentRunContext = await contextOf({
        contextPaths: [
          { path: '/a', kind: 'file', content: 'smuggled' },
          { path: '/b', kind: 'folder' },
          { path: '/c', kind: 'selection', content: 'picked' },
          { path: '/d', kind: 'selection' },
          { path: '/e', kind: 'selection', content: 'x'.repeat(200_001) },
          { path: '', kind: 'file' },
          { path: '/f', kind: 'nope' },
          null,
        ],
      });

      expect(context.contextPaths).toEqual([
        { path: '/a', kind: 'file' },
        { path: '/b', kind: 'folder' },
        { path: '/c', kind: 'selection', content: 'picked' },
      ]);
    });

    it('resume_ignoresEmptyIds', async () => {
      const context: AgentRunContext = await contextOf({
        resumeSessionId: '',
        resumeSessionAt: 7,
        forkSession: 'yes',
      });

      expect(context).toMatchObject({
        resumeSessionId: null,
        resumeSessionAt: null,
        forkSession: false,
      });
    });

    it('auth_comesFromTheConnectionsOwnKey', async () => {
      await invoke(AiChannel.SetConnectionKey, {
        connectionId: 'conn',
        authKind: 'api-key',
        key: 'secret',
      });

      expect((await contextOf()).auth.apiKey).toBe('secret');
    });

    it('bridge_stampsTheRunsOwnScope_whateverTheToolInputSays', async () => {
      const context: AgentRunContext = await contextOf({
        owningTabId: 'tab-1',
        surface: 'project',
      });

      void context.bridge
        .request('read', { workspaceRoot: '/elsewhere', owningTabId: 'other' }, 1)
        .catch((): void => undefined);

      const request: unknown = electron.sent.find(
        (message): boolean => message.channel === String(AiChannel.BridgeRequest),
      )?.payload;
      expect(request).toMatchObject({
        scope: { owningTabId: 'tab-1', surface: 'project', workspaceRoot: root },
      });
    });

    it('steer_reachesTheRunsHandler_untilItIsRemoved', async () => {
      const context: AgentRunContext = await contextOf();
      const heard: string[] = [];
      context.setSteerHandler((text: string): boolean => (heard.push(text), true));
      const steer: unknown = { requestId: 'r1', text: 'turn left' };

      expect(await invoke(AiChannel.Steer, steer)).toBe(true);
      context.setSteerHandler(null);
      expect(await invoke(AiChannel.Steer, steer)).toBe(false);

      expect(heard).toEqual(['turn left']);
    });

    it.each([
      [null],
      [{ requestId: 'r1' }],
      [{ requestId: 'r1', text: '' }],
      [{ requestId: 7, text: 'x' }],
      [{ requestId: 'nobody', text: 'x' }],
    ])('steer_thatCannotLand_isRefused %#', async (request: unknown) => {
      expect(await invoke(AiChannel.Steer, request)).toBe(false);
    });
  });

  describe('permissions', () => {
    let context: AgentRunContext;
    let finishRun: Deferred<void>;

    /**
     * Starts a run held open and asks for a permission through it.
     * @param name The tool's name.
     * @param detail The prompt's detail.
     * @param cancel The signal dismissing the prompt.
     * @returns Returns the pending answer and the prompt's id.
     */
    function ask(
      name: string = 'Write',
      detail: string = '/a',
      cancel?: AbortSignal,
    ): [Promise<boolean>, string] {
      const answer: Promise<boolean> = context.requestPermission(name, detail, cancel);
      const permissionId: unknown = eventsOf('permission').at(-1)?.['permissionId'];
      return [answer, String(permissionId)];
    }

    beforeEach(async () => {
      await invoke(AiChannel.ListProviders, [connection()]);
      finishRun = new Deferred<void>();
      provider.onRun = (): Promise<void> => finishRun.promise;
      await run();
      const held: AgentRunContext | undefined = provider.contexts[0];
      if (held === undefined) {
        throw new Error('The run never reached the provider');
      }
      context = held;
    });

    afterEach(() => {
      finishRun.resolve();
    });

    it('permission_grantedByTheUser_resolvesTrue', async () => {
      const [answer, permissionId]: [Promise<boolean>, string] = ask();

      reply(AiChannel.PermissionReply, { permissionId, granted: true });

      expect(await answer).toBe(true);
    });

    it('permission_deniedByTheUser_resolvesFalse', async () => {
      const [answer, permissionId]: [Promise<boolean>, string] = ask();

      reply(AiChannel.PermissionReply, { permissionId, granted: false });

      expect(await answer).toBe(false);
    });

    it.each([
      [null],
      ['yes'],
      [{ permissionId: 7, granted: true }],
      [{ permissionId: 'x', granted: 'true' }],
      [{ permissionId: 'unknown', granted: true }],
    ])('permission_aMalformedOrForeignReply_grantsNothing %#', async (bad: unknown) => {
      const [answer, permissionId]: [Promise<boolean>, string] = ask();

      reply(AiChannel.PermissionReply, bad);
      await settled();
      reply(AiChannel.PermissionReply, { permissionId, granted: false });

      expect(await answer).toBe(false);
    });

    it('permission_aReplyWithAnUnknownRememberScope_isIgnored', async () => {
      const [answer, permissionId]: [Promise<boolean>, string] = ask();

      reply(AiChannel.PermissionReply, { permissionId, granted: true, remember: 'forever' });
      reply(AiChannel.PermissionReply, { permissionId, granted: false });

      expect(await answer).toBe(false);
    });

    it('permission_replyingTwice_cannotReverseTheAnswer', async () => {
      const [answer, permissionId]: [Promise<boolean>, string] = ask();

      reply(AiChannel.PermissionReply, { permissionId, granted: false });
      reply(AiChannel.PermissionReply, { permissionId, granted: true });

      expect(await answer).toBe(false);
    });

    it('permission_grantedForTheSession_doesNotAskAgain', async () => {
      const [answer, permissionId]: [Promise<boolean>, string] = ask();
      reply(AiChannel.PermissionReply, { permissionId, granted: true, remember: 'session' });
      await answer;

      expect(await context.requestPermission('Write', '/b')).toBe(true);

      expect(eventsOf('permission')).toHaveLength(1);
    });

    it('permission_aDenialIsNeverRemembered', async () => {
      const [answer, permissionId]: [Promise<boolean>, string] = ask();
      reply(AiChannel.PermissionReply, { permissionId, granted: false, remember: 'always' });
      await answer;

      const [second]: [Promise<boolean>, string] = ask();

      expect(eventsOf('permission')).toHaveLength(2);
      reply(AiChannel.PermissionReply, {
        permissionId: eventsOf('permission').at(-1)?.['permissionId'],
        granted: false,
      });
      expect(await second).toBe(false);
    });

    it('permission_grantedForTheWorkspace_appliesOnlyThere', async () => {
      const [answer, permissionId]: [Promise<boolean>, string] = ask();
      reply(AiChannel.PermissionReply, { permissionId, granted: true, remember: 'workspace' });
      await answer;

      expect(await context.requestPermission('Write', '/b')).toBe(true);

      const elsewhere: Deferred<void> = new Deferred<void>();
      provider.onRun = (): Promise<void> => elsewhere.promise;
      await run({ requestId: 'r2', workspaceRoot: null });
      void provider.contexts.at(-1)?.requestPermission('Write', '/c');

      expect(eventsOf('permission')).toHaveLength(2);
      await invoke(AiChannel.Abort, 'r2');
      elsewhere.resolve();
    });

    it('permission_grantedAlways_coversOnlyTheExactCommandOfACommandTool', async () => {
      const [answer, permissionId]: [Promise<boolean>, string] = ask('Bash', 'npm test');
      reply(AiChannel.PermissionReply, { permissionId, granted: true, remember: 'always' });
      await answer;

      expect(await context.requestPermission('Bash', 'npm test')).toBe(true);
      void context.requestPermission('Bash', 'rm -rf /');

      expect(eventsOf('permission')).toHaveLength(2);
    });

    it('permission_aClippedCommand_cannotBeRememberedBeyondTheSession', async () => {
      const clipped: string = `${'x'.repeat(5000)}...`;
      const [answer, permissionId]: [Promise<boolean>, string] = ask('Bash', clipped);

      expect(eventsOf('permission').at(-1)?.['remembers']).toBe('session');
      reply(AiChannel.PermissionReply, { permissionId, granted: true, remember: 'always' });
      await answer;

      void context.requestPermission('Bash', clipped);

      expect(eventsOf('permission')).toHaveLength(2);
    });

    it('permission_openWhenTheRunIsStopped_resolvesFalse', async () => {
      const [answer]: [Promise<boolean>, string] = ask();

      await invoke(AiChannel.Abort, 'r1');

      expect(await answer).toBe(false);
    });

    it('permission_afterTheRunWasStopped_neverPrompts', async () => {
      await invoke(AiChannel.Abort, 'r1');
      const before: number = eventsOf('permission').length;

      expect(await context.requestPermission('Write', '/a')).toBe(false);

      expect(eventsOf('permission')).toHaveLength(before);
    });

    it('permission_answeredElsewhere_dismissesTheLocalPrompt', async () => {
      const cancel: AbortController = new AbortController();
      const [answer, permissionId]: [Promise<boolean>, string] = ask('Write', '/a', cancel.signal);

      cancel.abort();

      expect(await answer).toBe(false);
      expect(eventsOf('permission-dismissed')).toEqual([expect.objectContaining({ permissionId })]);
    });

    it('permission_withACancelAlreadyRaised_neverPrompts', async () => {
      const cancel: AbortController = new AbortController();
      cancel.abort();

      expect(await context.requestPermission('Write', '/a', cancel.signal)).toBe(false);

      expect(eventsOf('permission')).toEqual([]);
    });

    it('permission_toRunOutsideTheSandbox_isRememberedForTheExactCommandOnly', async () => {
      const name: string = 'Run outside the sandbox';
      void context.requestPermission(name, 'npm test');
      const permissionId: unknown = eventsOf('permission').at(-1)?.['permissionId'];

      reply(AiChannel.PermissionReply, { permissionId, granted: true, remember: 'session' });

      expect(eventsOf('permission').at(-1)?.['remembers']).toBe('session-command');
      expect(await context.requestPermission(name, 'npm test')).toBe(true);
      const before: number = eventsOf('permission').length;
      void context.requestPermission(name, 'rm -rf /');
      expect(eventsOf('permission')).toHaveLength(before + 1);
    });

    it('permission_toRunOutsideTheSandbox_ignoresAGrantLongerThanTheSession', async () => {
      const name: string = 'Run outside the sandbox';
      void context.requestPermission(name, 'npm test');
      const permissionId: unknown = eventsOf('permission').at(-1)?.['permissionId'];

      reply(AiChannel.PermissionReply, { permissionId, granted: true, remember: 'always' });
      await Promise.resolve();
      const before: number = eventsOf('permission').length;
      void context.requestPermission(name, 'npm test');

      expect(eventsOf('permission')).toHaveLength(before + 1);
    });

    it('permission_grantedForTheShell_neverCoversARunOutsideTheSandbox', async () => {
      void context.requestPermission('Bash', 'npm test');
      const permissionId: unknown = eventsOf('permission').at(-1)?.['permissionId'];
      reply(AiChannel.PermissionReply, { permissionId, granted: true, remember: 'session' });
      expect(await context.requestPermission('Bash', 'npm test')).toBe(true);
      const before: number = eventsOf('permission').length;

      void context.requestPermission('Run outside the sandbox', 'npm test');

      expect(eventsOf('permission')).toHaveLength(before + 1);
    });

    it('permission_carriesTheProposedChangeToThePrompt', () => {
      const change: never = { before: 'a', after: 'b' } as never;

      void context.requestPermission('Write', '/a', undefined, change);

      expect(eventsOf('permission').at(-1)?.['change']).toBe(change);
    });

    /**
     * Reads what has reached the audit log.
     * @returns Returns the entries, oldest first.
     */
    function auditedLines(): readonly Record<string, unknown>[] {
      return fs
        .readFileSync(path.join(userData, 'agent-audit-log.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map(
          (line: string): Record<string, unknown> => JSON.parse(line) as Record<string, unknown>,
        );
    }

    it('audit_recordsWhetherAShellCommandRanSandboxed', () => {
      context.recordAudit('Bash', 'ls', 'gated-or-auto', false);

      expect(auditedLines().at(-1)).toMatchObject({ tool: 'Bash', sandboxed: false });
    });

    it('audit_ofACommandOutsideTheSandbox_marksTheCall_andSaysWhyItWasAllowed', () => {
      context.recordAudit('Bash', 'ls', 'posture', false, 'toolu_1');

      expect(eventsOf('tool-unsandboxed').at(-1)).toMatchObject({
        toolId: 'toolu_1',
        reason: 'Ran outside the sandbox: Allow All is on.',
      });
    });

    it('audit_ofACommandInsideTheSandbox_marksNothing', () => {
      context.recordAudit('Bash', 'ls', 'posture', true, 'toolu_1');

      expect(eventsOf('tool-unsandboxed')).toEqual([]);
    });

    it('audit_withNoToolId_stillAuditsWithoutMarkingAnything', () => {
      context.recordAudit('Bash', 'ls', 'posture', false);

      expect(eventsOf('tool-unsandboxed')).toEqual([]);
      expect(auditedLines().at(-1)).toMatchObject({ sandboxed: false });
    });

    it('audit_ofAnythingElse_saysNothingAboutTheSandbox', () => {
      context.recordAudit('Write', '/a', 'gated-or-auto');

      expect(auditedLines().at(-1)).not.toHaveProperty('sandboxed');
    });

    it('audit_recordsToTheLogInUserData', () => {
      context.recordAudit('Write', '/a', 'prompt' as never);

      expect(fs.readdirSync(userData).join(' ')).toContain('audit');
    });

    describe('questions', () => {
      /**
       * Asks a question through the held run.
       * @param cancel The signal dismissing the question.
       * @returns Returns the pending answer and the question's id.
       */
      function question(cancel?: AbortSignal): [Promise<string | null>, unknown] {
        const answer: Promise<string | null> = context.requestInput('Which?', [], cancel);
        return [answer, eventsOf('input-request').at(-1)?.['inputId']];
      }

      it('input_answered_resolvesWithTheAnswer', async () => {
        const [answer, inputId]: [Promise<string | null>, unknown] = question();

        reply(AiChannel.InputReply, { inputId, answer: 'That one' });

        expect(await answer).toBe('That one');
      });

      it('input_declined_resolvesNull', async () => {
        const [answer, inputId]: [Promise<string | null>, unknown] = question();

        reply(AiChannel.InputReply, { inputId, answer: null });

        expect(await answer).toBeNull();
      });

      it.each([[null], [{ inputId: 7, answer: 'x' }], [{ inputId: 'x', answer: 7 }]])(
        'input_aMalformedReply_answersNothing %#',
        async (bad: unknown) => {
          const [answer, inputId]: [Promise<string | null>, unknown] = question();

          reply(AiChannel.InputReply, bad);
          reply(AiChannel.InputReply, { inputId, answer: 'real' });

          expect(await answer).toBe('real');
        },
      );

      it('input_openWhenTheRunIsStopped_resolvesNull', async () => {
        const [answer]: [Promise<string | null>, unknown] = question();

        await invoke(AiChannel.Abort, 'r1');

        expect(await answer).toBeNull();
      });

      it('input_answeredElsewhere_dismissesTheLocalPrompt', async () => {
        const cancel: AbortController = new AbortController();
        const [answer, inputId]: [Promise<string | null>, unknown] = question(cancel.signal);

        cancel.abort();

        expect(await answer).toBeNull();
        expect(eventsOf('input-dismissed')).toEqual([expect.objectContaining({ inputId })]);
      });

      it('input_afterTheRunWasStopped_neverAsks', async () => {
        await invoke(AiChannel.Abort, 'r1');

        expect(await context.requestInput('Which?', [])).toBeNull();

        expect(eventsOf('input-request')).toEqual([]);
      });
    });

    describe('edit decisions', () => {
      /**
       * Asks for an edit decision through the held run.
       * @returns Returns the pending decision and its id.
       */
      function decision(): [Promise<string>, unknown] {
        const answer: Promise<string> = context.requestEditDecision('a.ts', '1 line', true);
        return [answer, eventsOf('edit-decision').at(-1)?.['decisionId']];
      }

      it('edit_rejected_resolvesNo', async () => {
        const [answer, decisionId]: [Promise<string>, unknown] = decision();

        reply(AiChannel.EditDecisionReply, { decisionId, choice: 'no' });

        expect(await answer).toBe('no');
      });

      it('edit_openWhenTheRunIsStopped_resolvesNo', async () => {
        const [answer]: [Promise<string>, unknown] = decision();

        await invoke(AiChannel.Abort, 'r1');

        expect(await answer).toBe('no');
      });

      it('edit_autoAccepted_stopsAskingForTheSession', async () => {
        const [answer, decisionId]: [Promise<string>, unknown] = decision();
        reply(AiChannel.EditDecisionReply, { decisionId, choice: 'yes-auto' });

        expect(await answer).toBe('yes');
        expect(await context.requestEditDecision('b.ts', '1 line', true)).toBe('yes');

        expect(eventsOf('edit-decision')).toHaveLength(1);
      });

      it('edit_aYesAutoNamingNoOpenDecision_doesNotTurnOnAutoAccept', async () => {
        reply(AiChannel.EditDecisionReply, { decisionId: 'forged', choice: 'yes-auto' });

        const [answer, decisionId]: [Promise<string>, unknown] = decision();

        expect(eventsOf('edit-decision')).toHaveLength(1);
        reply(AiChannel.EditDecisionReply, { decisionId, choice: 'no' });
        expect(await answer).toBe('no');
      });

      it.each([[null], [{ decisionId: 7, choice: 'yes' }], [{ decisionId: 'x', choice: 'maybe' }]])(
        'edit_aMalformedReply_decidesNothing %#',
        async (bad: unknown) => {
          const [answer, decisionId]: [Promise<string>, unknown] = decision();

          reply(AiChannel.EditDecisionReply, bad);
          reply(AiChannel.EditDecisionReply, { decisionId, choice: 'no' });

          expect(await answer).toBe('no');
        },
      );
    });
  });

  describe('wall-clock budget', () => {
    let held: AgentRunContext | undefined;

    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      await invoke(AiChannel.ListProviders, [connection()]);
      held = undefined;
      provider.onRun = (context: AgentRunContext): Promise<void> => {
        held = context;
        return new Promise<void>((resolve: () => void): void => {
          context.signal.addEventListener('abort', (): void => resolve());
        });
      };
    });

    it('budget_expiring_stopsTheRun_andSaysWhy', async () => {
      await run({ runTimeoutMs: 120_000 });

      await vi.advanceTimersByTimeAsync(120_000);
      await settled();

      expect(statesOf()).toEqual(['started', 'error']);
      expect(eventsOf('status').at(-1)?.['detail']).toContain('2-minute time limit');
    });

    it('budget_ofOneMinute_isWordedInTheSingular', async () => {
      await run({ runTimeoutMs: 60_000 });

      await vi.advanceTimersByTimeAsync(60_000);
      await settled();

      expect(eventsOf('status').at(-1)?.['detail']).toContain('1-minute time limit');
    });

    it('budget_pausesWhileTheUserIsBeingAsked', async () => {
      await run({ runTimeoutMs: 60_000 });
      await vi.advanceTimersByTimeAsync(30_000);

      const answer: Promise<boolean> | undefined = held?.requestPermission('Write', '/a');
      await vi.advanceTimersByTimeAsync(600_000);

      expect(statesOf()).toEqual(['started']);

      reply(AiChannel.PermissionReply, {
        permissionId: eventsOf('permission')[0]?.['permissionId'],
        granted: true,
      });
      await answer;
      await vi.advanceTimersByTimeAsync(29_000);
      expect(statesOf()).toEqual(['started']);

      await vi.advanceTimersByTimeAsync(1_000);
      await settled();
      expect(statesOf()).toEqual(['started', 'error']);
    });

    it('budget_withOverlappingPrompts_resumesOnlyWhenTheLastSettles', async () => {
      await run({ runTimeoutMs: 60_000 });

      void held?.requestPermission('Write', '/a');
      void held?.requestInput('Which?', []);
      reply(AiChannel.PermissionReply, {
        permissionId: eventsOf('permission')[0]?.['permissionId'],
        granted: true,
      });
      await vi.advanceTimersByTimeAsync(600_000);

      expect(statesOf()).toEqual(['started']);
    });

    it.each([[0], [-1], [Number.NaN], [Number.POSITIVE_INFINITY]])(
      'budget_thatIsNotUsable_armsNothing %#',
      async (runTimeoutMs: number) => {
        await run({ runTimeoutMs });

        await vi.advanceTimersByTimeAsync(10_000_000);

        expect(statesOf()).toEqual(['started']);
      },
    );

    it('budget_isCappedAtTwoHours', async () => {
      await run({ runTimeoutMs: Number.MAX_SAFE_INTEGER });

      await vi.advanceTimersByTimeAsync(7_200_000);
      await settled();

      expect(statesOf().at(-1)).toBe('error');
    });

    it('budget_ofARunThatFinishes_neverFires', async () => {
      provider.onRun = (): Promise<void> => Promise.resolve();
      await run({ runTimeoutMs: 60_000 });

      await vi.advanceTimersByTimeAsync(600_000);

      expect(statesOf()).toEqual(['started', 'completed']);
    });
  });

  describe('delta coalescing', () => {
    let context: AgentRunContext;

    /**
     * Builds a text delta.
     * @param delta The text.
     * @param overrides The fields to change.
     * @returns Returns the event.
     */
    function text(delta: string, overrides: Record<string, unknown> = {}): AiEvent {
      return { requestId: 'r1', kind: 'text', delta, ...overrides };
    }

    /**
     * Lists the text deltas the window received.
     * @returns Returns them.
     */
    function deltas(): readonly unknown[] {
      return eventsOf('text').map((event: Record<string, unknown>): unknown => event['delta']);
    }

    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      await invoke(AiChannel.ListProviders, [connection()]);
      provider.onRun = (): Promise<void> => new Promise<void>((): void => undefined);
      await run();
      const held: AgentRunContext | undefined = provider.contexts[0];
      if (held === undefined) {
        throw new Error('The run never reached the provider');
      }
      context = held;
    });

    it('deltas_sendTheFirstAtOnce_andMergeTheFloodBehindIt', async () => {
      context.emit(text('a'));
      context.emit(text('b'));
      context.emit(text('c'));

      expect(deltas()).toEqual(['a']);

      await vi.advanceTimersByTimeAsync(33);

      expect(deltas()).toEqual(['a', 'bc']);
    });

    it('deltas_flushBeforeAnythingElse_soOrderIsKept', () => {
      context.emit(text('a'));
      context.emit(text('b'));
      context.emit({ requestId: 'r1', kind: 'status', state: 'completed', detail: '' });

      expect(events().slice(-3)).toEqual([
        expect.objectContaining({ delta: 'a' }),
        expect.objectContaining({ delta: 'b' }),
        expect.objectContaining({ kind: 'status', state: 'completed' }),
      ]);
    });

    it('deltas_ofDifferentRuns_neverMerge', async () => {
      context.emit(text('a'));
      context.emit(text('b'));
      context.emit(text('x', { requestId: 'r2' }));

      await vi.advanceTimersByTimeAsync(33);

      expect(deltas()).toEqual(['a', 'b', 'x']);
    });

    it('deltas_ofDifferentMessages_neverMerge', async () => {
      context.emit(text('a', { messageUuid: 'm1' }));
      context.emit(text('b', { messageUuid: 'm1' }));
      context.emit(text('x', { messageUuid: 'm2' }));

      await vi.advanceTimersByTimeAsync(33);

      expect(deltas()).toEqual(['a', 'b', 'x']);
    });

    it('deltas_ofDifferentSubAgents_neverMerge', async () => {
      context.emit(text('a'));
      context.emit(text('b'));
      context.emit(text('x', { parentToolId: 'sub' }));

      await vi.advanceTimersByTimeAsync(33);

      expect(deltas()).toEqual(['a', 'b', 'x']);
    });

    it('deltas_stillBuffered_flushAtShutdown', () => {
      context.emit(text('a'));
      context.emit(text('b'));

      manager.disposeAll();

      expect(deltas()).toEqual(['a', 'b']);
    });
  });

  describe('live sessions', () => {
    /**
     * Starts a turn in a live session.
     * @param agentSessionId The conversation.
     * @param overrides The request fields to change.
     * @returns Returns a promise resolving once the turn has started.
     */
    async function turn(
      agentSessionId: string = 'chat',
      overrides: Record<string, unknown> = {},
    ): Promise<void> {
      await run({ requestId: `r-${Math.random()}`, agentSessionId, ...overrides });
    }

    /**
     * Lists why sessions have ended, oldest first.
     * @returns Returns the reasons.
     */
    function endings(): readonly unknown[] {
      return eventsOf('session-ended').map(
        (event: Record<string, unknown>): unknown => event['reason'],
      );
    }

    beforeEach(async () => {
      provider = new FakeProvider('conn', { live: true });
      await invoke(AiChannel.ListProviders, [connection()]);
    });

    it('turn_withoutAConversation_runsTransiently', async () => {
      await run();

      expect(provider.sessions).toEqual([]);
      expect(provider.contexts).toHaveLength(1);
    });

    it('turn_inTheSameConversation_continuesTheOpenSession', async () => {
      await turn();
      await turn();

      expect(provider.sessions).toHaveLength(1);
      expect(provider.sessions[0]?.turns).toHaveLength(2);
    });

    it('turn_inADeadSession_reopensRatherThanHangingForever', async () => {
      await turn();
      const first: FakeSession | undefined = provider.sessions[0];
      if (first !== undefined) {
        first.alive = false;
      }

      await turn();

      expect(provider.sessions).toHaveLength(2);
      expect(endings()).toEqual(['reopened']);
    });

    it.each([
      ['mode', { mode: 'chat' }],
      ['surface', { surface: 'project' }],
      ['workspace', { workspaceRoot: null }],
      ['shell', { agentShell: '/bin/zsh' }],
    ])('turn_changing %s_reopensTheSession', async (_label: string, change: object) => {
      await turn();

      await turn('chat', change as Record<string, unknown>);

      expect(provider.sessions).toHaveLength(2);
      expect(provider.sessions[0]?.closed).toBe(1);
    });

    it('turn_thatFails_evictsTheSession_andLandsAsAnError', async () => {
      provider.onOpen = (): FakeSession => {
        const session: FakeSession = new FakeSession();
        session.onTurn = (): Promise<void> => Promise.reject(new Error('stream died'));
        return session;
      };

      await turn();

      expect(endings()).toEqual(['evicted']);
      expect(eventsOf('status').at(-1)).toMatchObject({ state: 'error', detail: 'stream died' });
    });

    it('turn_thatThrowsSynchronously_landsAsAnError_andLeavesTheSessionReapable', async () => {
      provider.onOpen = (): FakeSession => {
        const session: FakeSession = new FakeSession();
        session.onTurn = (): Promise<void> => {
          throw new Error('no turn for you');
        };
        return session;
      };

      await turn();

      expect(eventsOf('status').at(-1)).toMatchObject({
        state: 'error',
        detail: 'no turn for you',
      });
      expect(endings()).toEqual(['evicted']);
    });

    it('openSession_thatThrows_landsAsAnError', async () => {
      provider.onOpen = (): FakeSession => {
        throw new Error('harness would not start');
      };

      await turn();

      expect(eventsOf('status').at(-1)).toMatchObject({
        state: 'error',
        detail: 'harness would not start',
      });
    });

    it('close_thatRejects_isContained', async () => {
      const rejections: unknown[] = [];
      const onRejection: (reason: unknown) => void = (reason: unknown): void =>
        void rejections.push(reason);
      process.on('unhandledRejection', onRejection);
      provider.onOpen = (): FakeSession => {
        const session: FakeSession = new FakeSession();
        session.closeResult = (): Promise<void> => Promise.reject(new Error('close failed'));
        return session;
      };

      await turn();
      await invoke(AiChannel.CloseSession, 'chat');
      await settled();
      await settled();
      process.off('unhandledRejection', onRejection);

      expect(rejections).toEqual([]);
    });

    it('session_endingOnItsOwn_tellsTheRenderer_andNextTurnReopens', async () => {
      await turn();

      provider.sessions[0]?.ended?.('harness crashed');
      await turn();

      expect(endings()).toEqual(['harness crashed']);
      expect(provider.sessions).toHaveLength(2);
    });

    it('session_replaced_ignoresALateEndedFromTheOldOne', async () => {
      await turn();
      await turn('chat', { mode: 'chat' });

      provider.sessions[0]?.ended?.('late');

      expect(endings()).toEqual(['reopened']);
    });

    it('closeSession_closesAndForgets', async () => {
      await turn();

      await invoke(AiChannel.CloseSession, 'chat');
      await invoke(AiChannel.CloseSession, 'chat');

      expect(provider.sessions[0]?.closed).toBe(1);
      expect(endings()).toEqual(['closed']);
    });

    it('stopAgent_prefersTheGraduatedStop', async () => {
      const panicStop: Mock = vi.fn();
      provider.onOpen = (): FakeSession => Object.assign(new FakeSession(), { panicStop });
      await turn();

      await invoke(AiChannel.StopAgent, 'chat');

      expect(panicStop).toHaveBeenCalledOnce();
      expect(provider.sessions[0]?.closed).toBe(0);
    });

    it('stopAgent_withoutAGraduatedStop_closesOutright', async () => {
      await turn();

      await invoke(AiChannel.StopAgent, 'chat');

      expect(provider.sessions[0]?.closed).toBe(1);
    });

    it('stopTask_reachesTheSession_onlyWithBothFieldsWellFormed', async () => {
      await turn();

      await invoke(AiChannel.StopTask, { agentSessionId: 'chat', taskId: 't1' });
      await invoke(AiChannel.StopTask, { agentSessionId: 'chat', taskId: 7 });
      await invoke(AiChannel.StopTask, null);
      await invoke(AiChannel.StopTask, { agentSessionId: 'nobody', taskId: 't2' });

      expect(provider.sessions[0]?.stoppedTasks).toEqual(['t1']);
    });

    it('setRemoteControl_acceptsOnlyKnownModes', async () => {
      await turn();

      await invoke(AiChannel.SetSessionRemoteControl, 'chat', 'mirror');
      await invoke(AiChannel.SetSessionRemoteControl, 'chat', 'admin');
      await invoke(AiChannel.SetSessionRemoteControl, 7, 'off');
      await invoke(AiChannel.SetSessionRemoteControl, 'nobody', 'off');

      expect(provider.sessions[0]?.remoteControl).toEqual(['mirror']);
    });

    describe('reaping', () => {
      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      });

      it('reap_closesAnIdleSession_afterItsLifetime', async () => {
        await turn('chat', { agentSessionLifetimeMs: 1000 });

        await vi.advanceTimersByTimeAsync(1000);

        expect(endings()).toEqual(['idle']);
      });

      it('reap_withNoLifetime_neverCloses', async () => {
        await turn('chat', { agentSessionLifetimeMs: 0 });

        await vi.advanceTimersByTimeAsync(30 * 24 * 60 * 60 * 1000);

        expect(endings()).toEqual([]);
      });

      it('reap_leavesASessionWithATurnRunning', async () => {
        provider.onOpen = (): FakeSession => {
          const session: FakeSession = new FakeSession();
          session.onTurn = (): Promise<void> => new Promise<void>((): void => undefined);
          return session;
        };

        await turn('chat', { agentSessionLifetimeMs: 1000 });
        await vi.advanceTimersByTimeAsync(10_000);

        expect(endings()).toEqual([]);
      });

      it('reap_leavesASessionRunningABackgroundTask', async () => {
        let context: AgentRunContext | undefined;
        provider.onOpen = (): FakeSession => {
          const session: FakeSession = new FakeSession();
          session.onTurn = (held: AgentRunContext): Promise<void> => {
            context = held;
            return Promise.resolve();
          };
          return session;
        };
        await turn('chat', { agentSessionLifetimeMs: 1000 });

        context?.emit({
          requestId: context.requestId,
          kind: 'task-started',
          taskId: 't1',
          agentSessionId: 'chat',
        } as never);
        await vi.advanceTimersByTimeAsync(5000);

        expect(endings()).toEqual([]);
      });

      it('reap_activityPostponesIt', async () => {
        let context: AgentRunContext | undefined;
        provider.onOpen = (): FakeSession => {
          const session: FakeSession = new FakeSession();
          session.onTurn = (held: AgentRunContext): Promise<void> => {
            context = held;
            return Promise.resolve();
          };
          return session;
        };
        await turn('chat', { agentSessionLifetimeMs: 1000 });
        await vi.advanceTimersByTimeAsync(900);

        context?.emit({ requestId: context.requestId, kind: 'tool', name: 'x' } as never);
        await vi.advanceTimersByTimeAsync(900);

        expect(endings()).toEqual([]);

        await vi.advanceTimersByTimeAsync(100);

        expect(endings()).toEqual(['idle']);
      });

      it('reap_withALifetimeBeyondTheBound_isCappedAtSevenDays', async () => {
        await turn('chat', { agentSessionLifetimeMs: Number.MAX_SAFE_INTEGER });

        await vi.advanceTimersByTimeAsync(7 * 24 * 60 * 60 * 1000);

        expect(endings()).toEqual(['idle']);
      });
    });

    it('cap_evictsTheLeastRecentlyUsedIdleSession', async () => {
      await turn('a', { maxLiveSessions: 2 });
      await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 2));
      await turn('b', { maxLiveSessions: 2 });
      await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 2));
      await turn('a', { maxLiveSessions: 2 });
      await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 2));

      await turn('c', { maxLiveSessions: 2 });

      expect(eventsOf('session-ended').map((event): unknown => event['agentSessionId'])).toEqual([
        'b',
      ]);
    });

    it('cap_evictsAnIdleSessionBeforeABusyOne', async () => {
      provider.onOpen = (): FakeSession => {
        const session: FakeSession = new FakeSession();
        if (provider.sessions.length === 0) {
          session.onTurn = (): Promise<void> => new Promise<void>((): void => undefined);
        }
        return session;
      };
      await turn('busy', { maxLiveSessions: 2 });
      await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 2));
      await turn('idle', { maxLiveSessions: 2 });

      await turn('new', { maxLiveSessions: 2 });

      expect(eventsOf('session-ended').map((event): unknown => event['agentSessionId'])).toEqual([
        'idle',
      ]);
    });

    it('cap_ofZero_isNoLimit', async () => {
      await turn('a', { maxLiveSessions: 0 });
      await turn('b', { maxLiveSessions: 0 });
      await turn('c', { maxLiveSessions: 0 });

      expect(endings()).toEqual([]);
    });

    it('cap_neverEvictsTheSessionJustOpened', async () => {
      await turn('a', { maxLiveSessions: 1 });

      await turn('b', { maxLiveSessions: 1 });

      expect(eventsOf('session-ended').map((event): unknown => event['agentSessionId'])).toEqual([
        'a',
      ]);
    });

    it('retire_endsAnIdleSessionNow', async () => {
      await turn();

      manager.retireHarnessSessions(FAKE_HARNESS);

      expect(endings()).toEqual(['retired']);
    });

    it('retire_letsARunningTurnFinishFirst', async () => {
      const held: Deferred<void> = new Deferred<void>();
      provider.onOpen = (): FakeSession => {
        const session: FakeSession = new FakeSession();
        session.onTurn = (): Promise<void> => held.promise;
        return session;
      };
      await turn();

      manager.retireHarnessSessions(FAKE_HARNESS);

      expect(endings()).toEqual([]);

      held.resolve();
      await settled();

      expect(endings()).toEqual(['retired']);
    });

    it('retire_ofAnotherHarness_touchesNothing', async () => {
      await turn();

      manager.retireHarnessSessions('test.other');

      expect(endings()).toEqual([]);
    });

    it('disposeAll_closesEverySession_andAbortsEveryRun', async () => {
      const held: Deferred<void> = new Deferred<void>();
      provider.onOpen = (): FakeSession => {
        const session: FakeSession = new FakeSession();
        session.onTurn = (): Promise<void> => held.promise;
        return session;
      };
      await turn();

      manager.disposeAll();

      expect(provider.sessions[0]?.closed).toBe(1);
      expect(provider.contexts[0]?.signal.aborted).toBe(true);
      held.resolve();
    });
  });
});
