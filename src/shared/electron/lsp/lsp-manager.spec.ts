import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, WebContents } from 'electron';
import type { ClientCapabilities } from 'vscode-languageserver-protocol';

vi.mock('electron', () => ({
  ipcMain: { handle: (): void => undefined, on: (): void => undefined },
}));

const { LspManager } = await import('./lsp-manager');
const { clientCapabilities } = await import('./lsp-client-capabilities');
const { LspApplyEditForwarder } = await import('./lsp-apply-edit');
const { LspOpenDocuments } = await import('./lsp-open-documents');
const { WorkspaceContext } = await import('../workspace-context');
type ApplyEditResult = import('./lsp-apply-edit').ApplyEditResult;
type LspServerRegistry = import('./lsp-server-registry').LspServerRegistry;

/**
 * The part of the manager the specs reach past its privacy for: answering a server's requests.
 */
interface ManagerInternals {
  answerServerRequests(connection: unknown, sessionId: string, session: unknown): void;
  parseStartRequest(request: unknown): unknown;
  restart(id: string, braceStyle?: string): Promise<unknown>;
  readonly sessions: Map<string, unknown>;
  shutDown(id: string, session: unknown): Promise<void>;
  launch(request: unknown, sender: unknown): Promise<unknown>;
  start(request: unknown, sender: unknown): Promise<unknown>;
  forwardNotification(sessionId: string, method: string, params: unknown): void;
}

/**
 * A fake server connection recording the request handlers registered on it.
 */
interface FakeConnection {
  readonly handlers: Map<string, (params: unknown) => unknown>;
  fallback: (() => unknown) | null;
  onRequest(method: string | (() => unknown), handler?: (params: unknown) => unknown): void;
}

/**
 * Builds a fake server connection.
 * @returns Returns it.
 */
function fakeConnection(): FakeConnection {
  const connection: FakeConnection = {
    handlers: new Map<string, (params: unknown) => unknown>(),
    fallback: null,
    onRequest(method: string | (() => unknown), handler?: (params: unknown) => unknown): void {
      if (typeof method === 'string' && handler !== undefined) {
        connection.handlers.set(method, handler);
      } else if (typeof method === 'function') {
        connection.fallback = method;
      }
    },
  };
  return connection;
}

/**
 * Builds a fake renderer.
 * @param destroyed Whether it has been destroyed.
 * @returns Returns it.
 */
function contents(destroyed: boolean = false): WebContents {
  return { isDestroyed: (): boolean => destroyed } as unknown as WebContents;
}

describe('LspManager (#1015)', () => {
  it('advertisesRenameWithPrepare_versionedWorkspaceEdits_andApplyEdit_butNoFileOperations', () => {
    const capabilities: ClientCapabilities = clientCapabilities();

    expect(capabilities.textDocument?.rename).toEqual({ prepareSupport: true });
    expect(capabilities.workspace?.applyEdit).toBe(true);
    expect(capabilities.workspace?.workspaceEdit).toEqual({
      documentChanges: true,
      resourceOperations: [],
    });
  });

  it('advertisesCodeActionLiterals_resolveAndData_andExecuteCommand (#1016)', () => {
    const capabilities: ClientCapabilities = clientCapabilities();

    expect(capabilities.textDocument?.codeAction).toEqual({
      dynamicRegistration: false,
      codeActionLiteralSupport: {
        codeActionKind: {
          valueSet: [
            '',
            'quickfix',
            'refactor',
            'refactor.extract',
            'refactor.inline',
            'refactor.rewrite',
            'source',
            'source.organizeImports',
            'source.fixAll',
          ],
        },
      },
      isPreferredSupport: true,
      disabledSupport: true,
      dataSupport: true,
      resolveSupport: { properties: ['edit', 'command'] },
      honorsChangeAnnotations: false,
    });
    expect(capabilities.workspace?.executeCommand).toEqual({ dynamicRegistration: false });
  });

  it('forwardsAServersApplyEditToTheFirstLiveRendererHoldingTheSession_andAnswersWithItsResult', async () => {
    const forwarder: InstanceType<typeof LspApplyEditForwarder> = new LspApplyEditForwarder();
    const forwarded: { sessionId: string; target: WebContents | null; params: unknown }[] = [];
    vi.spyOn(forwarder, 'forward').mockImplementation(
      (
        sessionId: string,
        target: WebContents | null,
        params: unknown,
      ): Promise<ApplyEditResult> => {
        forwarded.push({ sessionId, target, params });
        return Promise.resolve({ applied: true });
      },
    );
    const manager: InstanceType<typeof LspManager> = new LspManager(
      (): BrowserWindow | null => null,
      new WorkspaceContext(),
      {} as LspServerRegistry,
      forwarder,
    );
    const gone: WebContents = contents(true);
    const live: WebContents = contents();
    const session: unknown = {
      clients: new Map<WebContents, number>([
        [gone, 1],
        [live, 1],
      ]),
      watcher: { register: (): void => undefined, unregister: (): void => undefined },
    };
    const connection: FakeConnection = fakeConnection();
    (manager as unknown as ManagerInternals).answerServerRequests(connection, 's1', session);
    const params: unknown = { edit: { changes: {} } };

    const answer: unknown = await connection.handlers.get('workspace/applyEdit')?.(params);

    expect(answer).toEqual({ applied: true });
    expect(forwarded).toEqual([{ sessionId: 's1', target: live, params }]);
    // Every other server request is still acknowledged with null.
    expect(connection.fallback?.()).toBeNull();
  });

  it('forwardsToTheMainWindow_whenNoRendererHoldsTheSession', async () => {
    const forwarder: InstanceType<typeof LspApplyEditForwarder> = new LspApplyEditForwarder();
    const targets: (WebContents | null)[] = [];
    vi.spyOn(forwarder, 'forward').mockImplementation(
      (_sessionId: string, target: WebContents | null): Promise<ApplyEditResult> => {
        targets.push(target);
        return Promise.resolve({ applied: false });
      },
    );
    const main: WebContents = contents();
    const manager: InstanceType<typeof LspManager> = new LspManager(
      (): BrowserWindow | null =>
        ({ isDestroyed: (): boolean => false, webContents: main }) as unknown as BrowserWindow,
      new WorkspaceContext(),
      {} as LspServerRegistry,
      forwarder,
    );
    const connection: FakeConnection = fakeConnection();
    (manager as unknown as ManagerInternals).answerServerRequests(connection, 's1', {
      clients: new Map<WebContents, number>(),
    });

    await connection.handlers.get('workspace/applyEdit')?.({ edit: {} });

    expect(targets).toEqual([main]);
  });

  describe('brace style (#1177)', () => {
    /**
     * Builds a manager with nothing behind it.
     * @returns Returns its internals.
     */
    function manager(): ManagerInternals {
      return new LspManager(
        (): BrowserWindow | null => null,
        new WorkspaceContext(),
        {} as LspServerRegistry,
        new LspApplyEditForwarder(),
      ) as unknown as ManagerInternals;
    }

    const REQUEST: Record<string, string> = {
      sessionId: '/root::csharp',
      serverId: 'csharp',
      rootPath: '/root',
    };

    it('aStartRequest_keepsAKnownBraceStyle_andIsRefusedForAnyOther', () => {
      const internals: ManagerInternals = manager();

      expect(internals.parseStartRequest({ ...REQUEST, braceStyle: 'allman' })).toEqual({
        ...REQUEST,
        standaloneFile: undefined,
        braceStyle: 'allman',
      });
      expect(internals.parseStartRequest(REQUEST)).toEqual({
        ...REQUEST,
        standaloneFile: undefined,
      });
      expect(internals.parseStartRequest({ ...REQUEST, braceStyle: 'whitesmiths' })).toBeNull();
      expect(internals.parseStartRequest({ ...REQUEST, braceStyle: 3 })).toBeNull();
    });

    it('aRestartWithANewBraceStyle_relaunchesWithIt_andWithoutOne_keepsTheOld', async () => {
      const internals: ManagerInternals = manager();
      const launched: unknown[] = [];
      vi.spyOn(internals, 'shutDown').mockResolvedValue(undefined);
      vi.spyOn(internals, 'launch').mockImplementation((request: unknown): Promise<unknown> => {
        launched.push(request);
        return Promise.resolve({ success: true });
      });
      internals.sessions.set('/root::csharp', {
        request: { ...REQUEST, braceStyle: 'allman' },
        clients: new Map<WebContents, number>(),
      });

      await internals.restart('/root::csharp', 'kr');
      internals.sessions.set('/root::csharp', {
        request: { ...REQUEST, braceStyle: 'allman' },
        clients: new Map<WebContents, number>(),
      });
      await internals.restart('/root::csharp');

      expect(launched).toEqual([
        { ...REQUEST, braceStyle: 'kr' },
        { ...REQUEST, braceStyle: 'allman' },
      ]);
    });
  });

  describe('server settings (#1143)', () => {
    it('answersAServersConfigurationRequest_fromTheUsersValuesForThatServer', async () => {
      const asked: string[] = [];
      const registry: unknown = {
        configurationOf: (serverId: string): unknown => {
          asked.push(serverId);
          return { 'projects.dotnet_enable_automatic_restore': false };
        },
      };
      const manager: InstanceType<typeof LspManager> = new LspManager(
        (): BrowserWindow | null => null,
        new WorkspaceContext(),
        registry as LspServerRegistry,
        new LspApplyEditForwarder(),
      );
      const connection: FakeConnection = fakeConnection();
      (manager as unknown as ManagerInternals).answerServerRequests(connection, '/root::csharp', {
        request: { sessionId: '/root::csharp', serverId: 'csharp', rootPath: '/root' },
        clients: new Map<WebContents, number>(),
        watcher: { register: (): void => undefined, unregister: (): void => undefined },
      });

      const answer: unknown = await connection.handlers.get('workspace/configuration')?.({
        items: [{ section: 'projects.dotnet_enable_automatic_restore' }, { section: 'other' }],
      });

      expect(answer).toEqual([false, null]);
      expect(asked).toEqual(['csharp']);
    });

    it('aChangedSetting_tellsThatServersSessionsToReadTheirConfigurationAgain_andNoOthers', () => {
      const manager: ManagerInternals & {
        announceConfigurationChange(changes: readonly unknown[]): void;
      } = new LspManager(
        (): BrowserWindow | null => null,
        new WorkspaceContext(),
        {
          pushedSettingsOf: (): undefined => undefined,
          pullsSettings: (): boolean => true,
        } as unknown as LspServerRegistry,
        new LspApplyEditForwarder(),
      ) as unknown as ManagerInternals & {
        announceConfigurationChange(changes: readonly unknown[]): void;
      };
      const sent: { session: string; method: string; params: unknown }[] = [];
      const session: (id: string, serverId: string) => unknown = (
        id: string,
        serverId: string,
      ): unknown => ({
        request: { sessionId: id, serverId, rootPath: '/root' },
        connection: {
          sendNotification: (method: string, params: unknown): Promise<void> => {
            sent.push({ session: id, method, params });
            return Promise.resolve();
          },
        },
      });
      manager.sessions.set('/a::csharp', session('/a::csharp', 'csharp'));
      manager.sessions.set('/b::csharp', session('/b::csharp', 'csharp'));
      manager.sessions.set('/a::typescript', session('/a::typescript', 'typescript'));

      manager.announceConfigurationChange([{ serverId: 'csharp', restart: false }]);

      expect(sent).toEqual([
        {
          session: '/a::csharp',
          method: 'workspace/didChangeConfiguration',
          params: { settings: null },
        },
        {
          session: '/b::csharp',
          method: 'workspace/didChangeConfiguration',
          params: { settings: null },
        },
      ]);
    });
  });

  describe('settings delivery (#1204)', () => {
    /**
     * The manager's internals the delivery specs reach.
     */
    type DeliveryInternals = ManagerInternals & {
      announceConfigurationChange(changes: readonly unknown[]): void;
      initialize(
        connection: unknown,
        rootPath: string,
        spec: unknown,
        pushed?: Record<string, unknown>,
      ): Promise<unknown>;
    };

    /**
     * Builds a manager whose registry pushes the given settings to the TypeScript server only.
     * @param pushed The settings the TypeScript server is pushed.
     * @returns Returns its internals.
     */
    function manager(pushed: Record<string, unknown>): DeliveryInternals {
      return new LspManager(
        (): BrowserWindow | null => null,
        new WorkspaceContext(),
        {
          pushedSettingsOf: (serverId: string): Record<string, unknown> | undefined =>
            serverId === 'typescript' ? pushed : undefined,
          // A server shaped like the JSON server never asks for its settings (#1219).
          pullsSettings: (serverId: string): boolean => serverId !== 'json',
        } as unknown as LspServerRegistry,
        new LspApplyEditForwarder(),
      ) as unknown as DeliveryInternals;
    }

    /**
     * Holds a session of a server in a manager, recording what it is sent.
     * @param internals The manager.
     * @param id The session.
     * @param serverId The server.
     * @param sent Receives each notification sent.
     */
    function hold(
      internals: DeliveryInternals,
      id: string,
      serverId: string,
      sent: { session: string; method: string; params: unknown }[],
    ): void {
      internals.sessions.set(id, {
        request: { sessionId: id, serverId, rootPath: '/root' },
        clients: new Map<WebContents, number>(),
        connection: {
          sendNotification: (method: string, params: unknown): Promise<void> => {
            sent.push({ session: id, method, params });
            return Promise.resolve();
          },
        },
        workspaceDiagnostics: null,
      });
    }

    const PUSHED: Record<string, unknown> = {
      typescript: { referencesCodeLens: { enabled: true } },
    };

    it('push_aChangeSendsTheSettingsShapedAsTheServerExpects_andTheEditorsAskAgain', () => {
      const internals: DeliveryInternals = manager(PUSHED);
      const sent: { session: string; method: string; params: unknown }[] = [];
      const forwarded: string[] = [];
      vi.spyOn(internals, 'forwardNotification').mockImplementation(
        (id: string, method: string): void => void forwarded.push(`${id} ${method}`),
      );
      hold(internals, '/a::typescript', 'typescript', sent);
      hold(internals, '/a::csharp', 'csharp', sent);

      internals.announceConfigurationChange([{ serverId: 'typescript', restart: false }]);

      expect(sent).toEqual([
        {
          session: '/a::typescript',
          method: 'workspace/didChangeConfiguration',
          params: { settings: PUSHED },
        },
      ]);
      expect(forwarded).toEqual([
        '/a::typescript workspace/codeLens/refresh',
        '/a::typescript workspace/inlayHint/refresh',
      ]);
    });

    it('pull_aChangeTellsTheServerToAskAgain_withNoSettings_andNoRefresh', () => {
      const internals: DeliveryInternals = manager(PUSHED);
      const sent: { session: string; method: string; params: unknown }[] = [];
      const forwarded: string[] = [];
      vi.spyOn(internals, 'forwardNotification').mockImplementation(
        (id: string, method: string): void => void forwarded.push(`${id} ${method}`),
      );
      hold(internals, '/a::csharp', 'csharp', sent);

      internals.announceConfigurationChange([{ serverId: 'csharp', restart: false }]);

      expect(sent).toEqual([
        {
          session: '/a::csharp',
          method: 'workspace/didChangeConfiguration',
          params: { settings: null },
        },
      ]);
      expect(forwarded).toEqual([]);
    });

    it('noPull_aServerThatNeverAsksAndIsPushedNothing_isNeverSentANullAnnouncement', () => {
      // The JSON server reads the settings it is sent, and throws on `{ settings: null }` (#1219).
      const internals: DeliveryInternals = manager(PUSHED);
      const sent: { session: string; method: string; params: unknown }[] = [];
      hold(internals, '/a::json', 'json', sent);

      internals.announceConfigurationChange([{ serverId: 'json', restart: false }]);

      expect(sent).toEqual([]);
    });

    it('noPull_aServerThatNeverAsks_isPushedItsSettingsAfterInitialized_andOnEveryChange', async () => {
      // The JSON server's own shape (#1219): `json.*` and `http.*`, never asked for.
      const json: Record<string, unknown> = {
        json: { validate: { enable: true } },
        http: { proxyStrictSSL: true },
      };
      const internals: DeliveryInternals = new LspManager(
        (): BrowserWindow | null => null,
        new WorkspaceContext(),
        {
          pushedSettingsOf: (): Record<string, unknown> => json,
          pullsSettings: (): boolean => false,
        } as unknown as LspServerRegistry,
        new LspApplyEditForwarder(),
      ) as unknown as DeliveryInternals;
      vi.spyOn(internals, 'forwardNotification').mockImplementation((): void => undefined);
      const sent: { session: string; method: string; params: unknown }[] = [];
      const connection: unknown = {
        sendRequest: (): Promise<unknown> => Promise.resolve({ capabilities: {} }),
        sendNotification: (method: string, params: unknown): Promise<void> => {
          sent.push({ session: 'starting', method, params });
          return Promise.resolve();
        },
      };

      await internals.initialize(connection, '/root', { command: 'server', args: [] }, json);
      hold(internals, '/a::json', 'json', sent);
      internals.announceConfigurationChange([{ serverId: 'json', restart: false }]);

      expect(sent).toEqual([
        { session: 'starting', method: 'initialized', params: {} },
        {
          session: 'starting',
          method: 'workspace/didChangeConfiguration',
          params: { settings: json },
        },
        {
          session: '/a::json',
          method: 'workspace/didChangeConfiguration',
          params: { settings: json },
        },
      ]);
    });

    it('startup_aChangeToASettingReadOnlyAtStartUp_restartsTheSessions_insteadOfTellingThem', () => {
      const internals: DeliveryInternals = manager(PUSHED);
      const sent: { session: string; method: string; params: unknown }[] = [];
      const restarted: string[] = [];
      vi.spyOn(internals, 'restart').mockImplementation((id: string): Promise<unknown> => {
        restarted.push(id);
        return Promise.resolve({ success: true });
      });
      hold(internals, '/a::java', 'java', sent);
      hold(internals, '/b::java', 'java', sent);
      hold(internals, '/a::typescript', 'typescript', sent);

      internals.announceConfigurationChange([{ serverId: 'java', restart: true }]);

      expect(restarted).toEqual(['/a::java', '/b::java']);
      expect(sent).toEqual([]);
    });

    it('push_aStartingServerIsSentItsSettingsRightAfterInitialized_beforeWhatItIsToldToOpen', async () => {
      const internals: DeliveryInternals = manager(PUSHED);
      const calls: { kind: string; method: string; params: unknown }[] = [];
      const connection: unknown = {
        sendRequest: (method: string, params: unknown): Promise<unknown> => {
          calls.push({ kind: 'request', method, params });
          return Promise.resolve({ capabilities: {} });
        },
        sendNotification: (method: string, params: unknown): Promise<void> => {
          calls.push({ kind: 'notification', method, params });
          return Promise.resolve();
        },
      };
      const spec: unknown = {
        command: 'server',
        args: [],
        initializationOptions: { preferences: { includeCompletionsForModuleExports: false } },
        postInitialize: [{ method: 'project/open', params: {} }],
      };

      await internals.initialize(connection, '/root', spec, PUSHED);

      expect(calls.map((call): string => call.method)).toEqual([
        'initialize',
        'initialized',
        'workspace/didChangeConfiguration',
        'project/open',
      ]);
      expect((calls[0].params as { initializationOptions: unknown }).initializationOptions).toEqual(
        { preferences: { includeCompletionsForModuleExports: false } },
      );
      expect(calls[2].params).toEqual({ settings: PUSHED });
    });

    it('pull_aStartingServerIsSentNothing_untilItAsks', async () => {
      const internals: DeliveryInternals = manager(PUSHED);
      const methods: string[] = [];
      const connection: unknown = {
        sendRequest: (method: string): Promise<unknown> => {
          methods.push(method);
          return Promise.resolve({ capabilities: {} });
        },
        sendNotification: (method: string): Promise<void> => {
          methods.push(method);
          return Promise.resolve();
        },
      };

      await internals.initialize(connection, '/root', { command: 'server', args: [] });

      expect(methods).toEqual(['initialize', 'initialized']);
    });
  });

  describe('workspace diagnostics (#1144)', () => {
    it('aServersRefresh_pullsAfresh_andIsAnswered', async () => {
      const manager: InstanceType<typeof LspManager> = new LspManager(
        (): BrowserWindow | null => null,
        new WorkspaceContext(),
        {} as LspServerRegistry,
        new LspApplyEditForwarder(),
      );
      let refreshed: number = 0;
      const connection: FakeConnection = fakeConnection();
      (manager as unknown as ManagerInternals).answerServerRequests(connection, '/root::csharp', {
        request: { sessionId: '/root::csharp', serverId: 'csharp', rootPath: '/root' },
        clients: new Map<WebContents, number>(),
        watcher: { register: (): void => undefined, unregister: (): void => undefined },
        workspaceDiagnostics: { refresh: (): void => void (refreshed += 1) },
      });

      const answer: unknown = await connection.handlers.get('workspace/diagnostic/refresh')?.(
        undefined,
      );

      expect(answer).toBeNull();
      expect(refreshed).toBe(1);
    });

    it('startsAPull_forAServerWhoseDescriptorSaysItServesThem_orWhoseCapabilitiesDo', () => {
      const pulling: (serverId: string, capabilities: unknown) => unknown[] = (
        serverId: string,
        capabilities: unknown,
      ): unknown[] => {
        const manager: InstanceType<typeof LspManager> = new LspManager(
          (): BrowserWindow | null => null,
          new WorkspaceContext(),
          {
            servesWorkspaceDiagnostics: (id: string): boolean => id === 'csharp',
          } as unknown as LspServerRegistry,
          new LspApplyEditForwarder(),
        );
        const requests: unknown[] = [];
        const session: { request: unknown; connection: unknown; workspaceDiagnostics: unknown } = {
          request: { sessionId: 's', serverId, rootPath: '/root' },
          connection: {
            sendRequest: (method: string, params: unknown): Promise<unknown> => {
              requests.push({ method, params });
              return new Promise<unknown>((): void => undefined);
            },
          },
          workspaceDiagnostics: null,
        };
        (
          manager as unknown as {
            startWorkspaceDiagnostics(id: string, session: unknown, result: unknown): void;
          }
        ).startWorkspaceDiagnostics('s', session, { capabilities });
        return requests;
      };

      expect(pulling('csharp', { diagnosticProvider: { workspaceDiagnostics: false } })).toEqual([
        {
          method: 'workspace/diagnostic',
          params: { previousResultIds: [], partialResultToken: expect.any(String) as unknown },
        },
      ]);
      expect(pulling('rust', { diagnosticProvider: { workspaceDiagnostics: true } })).toHaveLength(
        1,
      );
      expect(pulling('rust', { diagnosticProvider: { workspaceDiagnostics: false } })).toEqual([]);
    });
  });

  describe('workspace diagnostics from the renderer and settings (#1144)', () => {
    /**
     * Builds a manager holding one session whose pull records what it is asked.
     * @param calls Receives the pull's calls.
     * @returns Returns the manager's internals.
     */
    function holding(calls: string[]): ManagerInternals & {
      notify(id: unknown, method: unknown, params: unknown): void;
      announceConfigurationChange(changes: readonly unknown[]): void;
    } {
      const manager: unknown = new LspManager(
        (): BrowserWindow | null => null,
        new WorkspaceContext(),
        {
          pushedSettingsOf: (): undefined => undefined,
          pullsSettings: (): boolean => true,
        } as unknown as LspServerRegistry,
        new LspApplyEditForwarder(),
      );
      const internals: ManagerInternals = manager as ManagerInternals;
      internals.sessions.set('/root::csharp', {
        request: { sessionId: '/root::csharp', serverId: 'csharp', rootPath: '/root' },
        connection: {
          sendNotification: (method: string): Promise<void> => {
            calls.push(`server:${method}`);
            return Promise.resolve();
          },
        },
        workspaceDiagnostics: {
          refresh: (forget?: string): void => void calls.push(`refresh:${forget ?? ''}`),
          reset: (): void => void calls.push('reset'),
        },
      });
      return manager as ManagerInternals & {
        notify(id: unknown, method: unknown, params: unknown): void;
        announceConfigurationChange(changes: readonly unknown[]): void;
      };
    }

    it('aClosedDocument_refreshesThePull_forgettingIt_withoutTellingTheServer', () => {
      const calls: string[] = [];
      holding(calls).notify('/root::csharp', 'studio/refreshWorkspaceDiagnostics', {
        uri: 'file:///root/Broken.cs',
      });

      expect(calls).toEqual(['refresh:file:///root/Broken.cs']);
    });

    it('aSettingsChange_startsThePullOver', () => {
      const calls: string[] = [];
      holding(calls).announceConfigurationChange([{ serverId: 'csharp', restart: false }]);

      expect(calls).toEqual(['server:workspace/didChangeConfiguration', 'reset']);
    });
  });

  it('aServersInlayHintRefresh_isSentOnToItsRenderers_andAnswered (#1145)', async () => {
    const manager: InstanceType<typeof LspManager> = new LspManager(
      (): BrowserWindow | null => null,
      new WorkspaceContext(),
      {} as LspServerRegistry,
      new LspApplyEditForwarder(),
    );
    const forwarded: string[] = [];
    vi.spyOn(
      manager as unknown as { forwardNotification(id: string, method: string): void },
      'forwardNotification',
    ).mockImplementation(
      (id: string, method: string): void => void forwarded.push(`${id} ${method}`),
    );
    const connection: FakeConnection = fakeConnection();
    (manager as unknown as ManagerInternals).answerServerRequests(connection, '/root::csharp', {
      request: { sessionId: '/root::csharp', serverId: 'csharp', rootPath: '/root' },
      clients: new Map<WebContents, number>(),
      watcher: { register: (): void => undefined, unregister: (): void => undefined },
    });

    const answer: unknown = await connection.handlers.get('workspace/inlayHint/refresh')?.(
      undefined,
    );
    const lensAnswer: unknown = await connection.handlers.get('workspace/codeLens/refresh')?.(
      undefined,
    );

    expect(answer).toBeNull();
    expect(lensAnswer).toBeNull();
    // ...and a code lens refresh likewise (#1149).
    expect(forwarded).toEqual([
      '/root::csharp workspace/inlayHint/refresh',
      '/root::csharp workspace/codeLens/refresh',
    ]);
  });

  it('aServersRequestToAttachTheDebugger_isForwardedToTheRendererHoldingTheSession (#1150)', async () => {
    const attaches: { forward: unknown; register: () => void; dispose: () => void } = {
      forward: vi.fn((): Promise<{ didAttach: boolean }> => Promise.resolve({ didAttach: true })),
      register: (): void => undefined,
      dispose: (): void => undefined,
    };
    const manager: InstanceType<typeof LspManager> = new LspManager(
      (): BrowserWindow | null => null,
      new WorkspaceContext(),
      {} as LspServerRegistry,
      new LspApplyEditForwarder(),
      attaches as unknown as ConstructorParameters<typeof LspManager>[4],
    );
    const live: WebContents = contents();
    const connection: FakeConnection = fakeConnection();
    (manager as unknown as ManagerInternals).answerServerRequests(connection, '/root::csharp', {
      request: { sessionId: '/root::csharp', serverId: 'csharp', rootPath: '/root' },
      clients: new Map<WebContents, number>([[live, 1]]),
      watcher: { register: (): void => undefined, unregister: (): void => undefined },
    });

    const answer: unknown = await connection.handlers.get('workspace/attachDebugger')?.({
      processId: 46456,
    });

    expect(answer).toEqual({ didAttach: true });
    expect(attaches.forward).toHaveBeenCalledWith('/root::csharp', live, { processId: 46456 });
  });

  describe('open documents across windows (#1190)', () => {
    /**
     * The manager, as the specs send it renderers' notifications.
     */
    type Notifying = ManagerInternals & {
      notify(id: unknown, method: unknown, params: unknown, sender?: unknown): void;
    };

    /**
     * Builds a manager holding one session, recording what the server is sent.
     * @param sent Receives each notification the server is sent.
     * @returns Returns the manager's internals.
     */
    function holding(sent: string[]): Notifying {
      const manager: unknown = new LspManager(
        (): BrowserWindow | null => null,
        new WorkspaceContext(),
        {} as LspServerRegistry,
        new LspApplyEditForwarder(),
      );
      (manager as ManagerInternals).sessions.set('/root::csharp', {
        request: { sessionId: '/root::csharp', serverId: 'csharp', rootPath: '/root' },
        connection: {
          sendNotification: (method: string, params: unknown): Promise<void> => {
            sent.push(
              `${method} ${(params as { textDocument?: { uri?: string } }).textDocument?.uri ?? ''}`,
            );
            return Promise.resolve();
          },
        },
        openDocuments: new LspOpenDocuments<unknown>(),
      });
      return manager as Notifying;
    }

    const OPEN: unknown = { textDocument: { uri: 'file:///root/A.cs', text: '' } };
    const CLOSE: unknown = { textDocument: { uri: 'file:///root/A.cs' } };

    it('aWindowReopeningADocumentTheServerHasOpen_closesItThereFirst', () => {
      const sent: string[] = [];
      const manager: Notifying = holding(sent);
      const window: WebContents = contents();

      manager.notify('/root::csharp', 'textDocument/didOpen', OPEN, window);
      manager.notify('/root::csharp', 'textDocument/didOpen', OPEN, window);

      expect(sent).toEqual([
        'textDocument/didOpen file:///root/A.cs',
        'textDocument/didClose file:///root/A.cs',
        'textDocument/didOpen file:///root/A.cs',
      ]);
    });

    it('aDocumentClosedByOneWindow_staysOpenOnTheServerWhileAnotherHoldsIt', () => {
      const sent: string[] = [];
      const manager: Notifying = holding(sent);
      const main: WebContents = contents();
      const popOut: WebContents = contents();
      manager.notify('/root::csharp', 'textDocument/didOpen', OPEN, main);
      manager.notify('/root::csharp', 'textDocument/didOpen', OPEN, popOut);
      sent.length = 0;

      manager.notify('/root::csharp', 'textDocument/didClose', CLOSE, popOut);
      expect(sent).toEqual([]);
      manager.notify('/root::csharp', 'textDocument/didClose', CLOSE, main);
      expect(sent).toEqual(['textDocument/didClose file:///root/A.cs']);
    });
  });

  describe('a window attaching to a running session (#1182)', () => {
    /**
     * A window recording what it is sent.
     * @returns Returns the window and what it was sent.
     */
    function window(): { contents: WebContents; sent: { method: string; params: unknown }[] } {
      const sent: { method: string; params: unknown }[] = [];
      const contents: unknown = {
        isDestroyed: (): boolean => false,
        once: (): void => undefined,
        send: (_channel: string, message: { method: string; params: unknown }): void =>
          void sent.push({ method: message.method, params: message.params }),
      };
      return { contents: contents as WebContents, sent };
    }

    const REPORT: unknown = {
      uri: 'file:///root/Broken.cs',
      kind: 'full',
      items: [{ message: 'CS0029' }],
    };

    /**
     * Builds a manager holding a loaded session whose pull holds one report.
     * @param loaded Whether the server has said it loaded the workspace.
     * @returns Returns the manager's internals.
     */
    function running(loaded: boolean): ManagerInternals {
      const manager: unknown = new LspManager(
        (): BrowserWindow | null => null,
        new WorkspaceContext(),
        {} as LspServerRegistry,
        new LspApplyEditForwarder(),
      );
      (manager as ManagerInternals).sessions.set('/root::csharp', {
        request: { sessionId: '/root::csharp', serverId: 'csharp', rootPath: '/root' },
        clients: new Map<WebContents, number>(),
        ready: Promise.resolve({ success: true, capabilities: {} }),
        workspaceDiagnostics: { snapshot: (): unknown[] => [REPORT] },
        loaded,
        analysed: loaded,
        openDocuments: new LspOpenDocuments<unknown>(),
      });
      return manager as ManagerInternals;
    }

    const START: unknown = { sessionId: '/root::csharp', serverId: 'csharp', rootPath: '/root' };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('isToldTheWorkspacesDiagnosticsAsTheyStand_andThatTheServerLoadedIt', async () => {
      const internals: ManagerInternals = running(true);
      const late: { contents: WebContents; sent: { method: string; params: unknown }[] } = window();

      await internals.start(START, late.contents);
      await vi.advanceTimersByTimeAsync(0);

      // Loaded first: the window takes a pull as complete only from a server it knows has loaded.
      expect(late.sent).toEqual([
        { method: 'workspace/projectInitializationComplete', params: {} },
        { method: 'studio/workspaceDiagnostics', params: { reports: [REPORT], complete: true } },
      ]);
    });

    it('beforeTheServerHasLoaded_isNotToldItHas', async () => {
      const internals: ManagerInternals = running(false);
      const late: { contents: WebContents; sent: { method: string; params: unknown }[] } = window();

      await internals.start(START, late.contents);
      await vi.advanceTimersByTimeAsync(0);

      expect(late.sent.map((entry: { method: string }): string => entry.method)).not.toContain(
        'workspace/projectInitializationComplete',
      );
    });

    it('theServerSayingItLoaded_isRemembered', () => {
      const internals: ManagerInternals = running(false);

      internals.forwardNotification('/root::csharp', 'workspace/projectInitializationComplete', {});

      expect((internals.sessions.get('/root::csharp') as { loaded: boolean }).loaded).toBe(true);
    });
  });
});
