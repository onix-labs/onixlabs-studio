import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Bridge } from '@shared/api/bridge';
import {
  LspChannel,
  LspServerSummary,
  LspSettings as LspSettingsData,
  LspStartRequest,
  LspStartResult,
  LspShowMessageRequest,
} from '@shared/api/lsp-channels';

import { DirectoryListing } from '@shared/api/workspace-channels';
import { Diagnostic, Diagnostics, DiagnosticsProvider } from '../diagnostics/diagnostics';
import { Output, OutputChannelInfo } from '../output/output';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { LspClient, testLines, WorkspaceSymbolMatch } from './lsp-client';
import { LspDocumentRef, LspFeatures, LspSessionSupport } from './lsp-features';
import { WorkspaceEditApplier } from '@shared/angular/services/workspace-edit/workspace-edit-applier';
import type {
  WorkspaceEditOutcome,
  WorkspaceTextEdits,
} from '@shared/angular/services/workspace-edit/workspace-edit';
import { LspSettings } from '@shared/angular/services/lsp-settings/lsp-settings';
import { Settings } from '@shared/angular/services/settings/settings';
import { DebugAttachRouter } from '@shared/angular/services/debug-attach/debug-attach-router';
import {
  Notification,
  NotificationAction,
  NotificationRequest,
  Notifications,
} from '@shared/angular/services/notifications/notifications';
import { LanguageSupportPrompt } from '@shared/angular/services/plugins/language-support-prompt';
import { LspServer, LspStatus, NOTICE_MS } from './lsp-status';

/**
 * The registered servers these tests run against, standing in for the catalogue the real settings
 * service loads from the main process.
 */
const CATALOGUE: readonly LspServerSummary[] = [
  {
    id: 'typescript',
    displayName: 'TypeScript',
    languages: ['typescript', 'javascript'],
    priority: 100,
  },
  { id: 'csharp', displayName: 'Roslyn', languages: ['csharp'], priority: 100 },
  { id: 'java', displayName: 'Eclipse JDT', languages: ['java'], priority: 100 },
  { id: 'pyright', displayName: 'Pyright', languages: ['python'], priority: 100 },
];

/**
 * A fake transport that records what the client sends over the LSP channels and lets the test push
 * server notifications and exits back through the captured listeners.
 */
class FakeLsp implements Bridge {
  public readonly starts: LspStartRequest[] = [];
  public readonly notifications: { sessionId: string; method: string; params: unknown }[] = [];
  public readonly stops: string[] = [];
  public readonly restarts: string[] = [];
  /** The brace style each restart was asked to start with, if any (#1177). */
  public readonly restartBraceStyles: unknown[] = [];
  /**
   * The sessions the (fake) main process currently has running: a successful Start adds one, a stop
   * or an exit removes it, and a Restart of anything else answers "No such session" as the real one
   * does.
   */
  public readonly running: Set<string> = new Set<string>();
  public startResult: LspStartResult = { success: true };
  public diagnosticReport: unknown = null;
  /** The requests the client sent its servers, and the answers given for chosen methods (#1143). */
  public readonly requests: { sessionId: string; method: string; params: unknown }[] = [];
  public readonly requestAnswers: Record<string, unknown> = {};
  private notificationListener: ((...args: unknown[]) => void) | null = null;
  private exitListener: ((...args: unknown[]) => void) | null = null;
  private applyEditListener: ((...args: unknown[]) => void) | null = null;
  public readonly applyEditReplies: unknown[] = [];
  /** The answers to requests to attach the debugger (#1150). */
  public readonly attachReplies: unknown[] = [];
  private attachListener: ((...args: unknown[]) => void) | null = null;
  /** The answers to a server's questions (#1154). */
  public readonly questionReplies: unknown[] = [];
  private questionListener: ((...args: unknown[]) => void) | null = null;

  public attachDebugger(request: unknown): void {
    this.attachListener?.(request);
  }

  public ask(request: unknown): void {
    this.questionListener?.(request);
  }

  public invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    switch (channel) {
      case LspChannel.Start as string:
        this.starts.push(args[0] as LspStartRequest);
        if (this.startResult.success) {
          this.running.add((args[0] as LspStartRequest).sessionId);
        }
        return Promise.resolve(this.startResult as T);
      case LspChannel.Restart as string: {
        const sessionId: string = args[0] as string;
        this.restarts.push(sessionId);
        this.restartBraceStyles.push(args[1]);
        if (!this.running.has(sessionId)) {
          return Promise.resolve({ success: false, error: 'No such session' } as T);
        }
        // The real main process respawns under the same id and tells every holder through a
        // restarted exit; the holders re-attach as they re-open.
        this.exitListener?.({ sessionId, code: null, signal: null, restarted: true });
        return Promise.resolve(this.startResult as T);
      }
      case LspChannel.Request as string:
        this.requests.push({
          sessionId: args[0] as string,
          method: args[1] as string,
          params: args[2],
        });
        if (typeof args[1] === 'string' && args[1] in this.requestAnswers) {
          return Promise.resolve(this.requestAnswers[args[1]] as T);
        }
        return Promise.resolve(
          (args[1] === 'textDocument/diagnostic' ? this.diagnosticReport : null) as T,
        );
      case LspChannel.Stop as string:
        this.stops.push(args[0] as string);
        this.running.delete(args[0] as string);
        return Promise.resolve(undefined as T);
      case LspChannel.GetSettings as string:
        return Promise.resolve({
          disabledServers: [],
          javaPath: null,
          dotnetPath: null,
          serverPaths: {},
          serverArgs: {},
          languageServers: {},
          serverSettings: {},
        } as LspSettingsData as T);
      case LspChannel.SetSettings as string:
        return Promise.resolve(args[0] as T);
      default:
        return Promise.resolve(null as T);
    }
  }

  public send(channel: string, ...args: unknown[]): void {
    if (channel === (LspChannel.ApplyEditReply as string)) {
      this.applyEditReplies.push(args[0]);
    }
    if (channel === (LspChannel.AttachDebuggerReply as string)) {
      this.attachReplies.push(args[0]);
    }
    if (channel === (LspChannel.ShowMessageReply as string)) {
      this.questionReplies.push(args[0]);
    }
    if (channel === (LspChannel.Notify as string)) {
      this.notifications.push({
        sessionId: args[0] as string,
        method: args[1] as string,
        params: args[2],
      });
    }
  }

  public on(channel: string, listener: (...args: unknown[]) => void): () => void {
    if (channel === (LspChannel.Notification as string)) {
      this.notificationListener = listener;
      return (): void => {
        this.notificationListener = null;
      };
    }
    if (channel === (LspChannel.ApplyEdit as string)) {
      this.applyEditListener = listener;
      return (): void => {
        this.applyEditListener = null;
      };
    }
    if (channel === (LspChannel.AttachDebugger as string)) {
      this.attachListener = listener;
      return (): void => {
        this.attachListener = null;
      };
    }
    if (channel === (LspChannel.ShowMessage as string)) {
      this.questionListener = listener;
      return (): void => {
        this.questionListener = null;
      };
    }
    if (channel === (LspChannel.ServerExit as string)) {
      this.exitListener = listener;
      return (): void => {
        this.exitListener = null;
      };
    }
    return (): void => undefined;
  }

  public applyEdit(sessionId: string, edit: unknown): void {
    this.applyEditListener?.({ requestId: 'r1', sessionId, edit });
  }

  public publishDiagnostics(sessionId: string, uri: string, diagnostics: unknown[]): void {
    this.notificationListener?.({
      sessionId,
      method: 'textDocument/publishDiagnostics',
      params: { uri, diagnostics },
    });
  }

  public notify(sessionId: string, method: string, params: unknown): void {
    this.notificationListener?.({ sessionId, method, params });
  }

  public logMessage(sessionId: string, message: string): void {
    this.notificationListener?.({
      sessionId,
      method: 'window/logMessage',
      params: { type: 3, message },
    });
  }

  public exit(
    sessionId: string,
    reason?: string,
    how: { code: number | null; signal: string | null } = { code: 1, signal: null },
  ): void {
    this.running.delete(sessionId);
    this.exitListener?.({
      sessionId,
      ...how,
      ...(reason === undefined ? {} : { reason }),
    });
  }

  public notificationsTo(method: string): { sessionId: string; params: unknown }[] {
    return this.notifications.filter((entry): boolean => entry.method === `textDocument/${method}`);
  }
}

/**
 * A fake diagnostics aggregate that captures the registered provider's emissions.
 */
class FakeDiagnostics {
  public emitted: readonly Diagnostic[] = [];

  public register(provider: DiagnosticsProvider): () => void {
    return provider.connect((diagnostics: readonly Diagnostic[]): void => {
      this.emitted = diagnostics;
    });
  }
}

/**
 * A fake Monaco service that records which languages had their built-in diagnostics suppressed and
 * reports no loaded editor (so marker-setting is skipped under jsdom).
 */
class FakeMonaco {
  public readonly suppressed: string[] = [];

  public suppressBuiltInDiagnostics(languageId: string): void {
    this.suppressed.push(languageId);
  }

  public getMonaco(): undefined {
    return undefined;
  }

  public ensureLoaded(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * A fake features registry that records semantic-token refreshes and lets a test fire the served
 * signal a real server would trigger by answering a request.
 */
class FakeFeatures {
  public readonly refreshes: (readonly string[] | undefined)[] = [];
  private servedListener: ((sessionId: string) => void) | null = null;
  public resolver: ((path: string) => LspDocumentRef | null) | null = null;

  public registerDocuments(resolver: (path: string) => LspDocumentRef | null): () => void {
    this.resolver = resolver;
    return (): void => undefined;
  }

  public registerServedListener(listener: (sessionId: string) => void): () => void {
    this.servedListener = listener;
    return (): void => {
      this.servedListener = null;
    };
  }

  public refreshSemanticTokens(languages?: readonly string[]): void {
    this.refreshes.push(languages);
  }

  /** The languages formatting was turned on for, with the support it was turned on with (#1141). */
  public readonly formattingEnabled: [string, unknown][] = [];

  public enableFormatting(language: string, support: unknown): void {
    this.formattingEnabled.push([language, support]);
  }
  /** The languages hints were turned on for (#1145). */
  public readonly inlayHintsEnabled: string[] = [];
  public inlayHintRefreshes: number = 0;

  public enableInlayHints(language: string): void {
    this.inlayHintsEnabled.push(language);
  }

  /** The languages the compiler's views of structure were turned on for, with what (#1147). */
  public readonly structureEnabled: [string, unknown][] = [];

  public enableStructure(language: string, support: unknown): void {
    this.structureEnabled.push([language, support]);
  }

  /** The languages code lenses were turned on for, and how many refreshes were asked (#1149). */
  public readonly codeLensEnabled: string[] = [];
  public codeLensRefreshes: number = 0;

  public enableCodeLens(language: string): void {
    this.codeLensEnabled.push(language);
  }

  public refreshCodeLenses(): void {
    this.codeLensRefreshes += 1;
  }

  public refreshInlayHints(): void {
    this.inlayHintRefreshes += 1;
  }

  public readonly supports: [string, LspSessionSupport | null][] = [];

  public setSessionSupport(sessionId: string, support: LspSessionSupport | null): void {
    this.supports.push([sessionId, support]);
  }

  public served(sessionId: string): void {
    this.servedListener?.(sessionId);
  }
}

/**
 * Resolves pending promise-queue microtasks and timers so the client's deferred sends run.
 * @returns Returns a promise that resolves on the next macrotask.
 */
function flush(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

describe('LspClient', () => {
  let lsp: FakeLsp;
  let diagnostics: FakeDiagnostics;
  let monaco: FakeMonaco;
  let root: WritableSignal<DirectoryListing | null>;
  let disabledServers: Set<string>;
  let offeredLanguages: string[];
  let installedServers: WritableSignal<readonly LspServerSummary[]>;
  let catalogueLoaded: WritableSignal<boolean>;
  let serverSettings: Record<string, Record<string, unknown>>;

  /**
   * Builds the client under test with the fakes wired in.
   * @returns Returns the client.
   */
  function build(features?: FakeFeatures): LspClient {
    TestBed.configureTestingModule({
      providers: [
        LspClient,
        { provide: Diagnostics, useValue: diagnostics },
        { provide: Monaco, useValue: monaco },
        { provide: Workspace, useValue: { root } },
        {
          provide: LanguageSupportPrompt,
          useValue: {
            offerFor: (language: string): void => {
              offeredLanguages.push(language);
            },
          },
        },
        {
          provide: LspSettings,
          useValue: {
            isDisabled: (serverId: string): boolean => disabledServers.has(serverId),
            // The catalogue the real service loads from the main process, stubbed to the servers these
            // tests exercise: the client asks which server serves a language rather than knowing.
            serverForLanguage: (language: string): string | null =>
              installedServers().find((server: LspServerSummary): boolean =>
                server.languages.includes(language),
              )?.id ?? null,
            catalogue: (): readonly LspServerSummary[] => installedServers(),
            catalogueLoaded: (): boolean => catalogueLoaded(),
            displayNameOf: (): string | null => null,
            serverSetting: (serverId: string, section: string): unknown =>
              serverSettings[serverId]?.[section],
            ready: Promise.resolve(),
          },
        },
        ...(features === undefined
          ? []
          : [{ provide: LspFeatures, useValue: features as unknown as LspFeatures }]),
      ],
    });
    return TestBed.inject(LspClient);
  }

  beforeEach(() => {
    lsp = new FakeLsp();
    diagnostics = new FakeDiagnostics();
    monaco = new FakeMonaco();
    disabledServers = new Set<string>();
    offeredLanguages = [];
    installedServers = signal<readonly LspServerSummary[]>(CATALOGUE);
    catalogueLoaded = signal<boolean>(true);
    serverSettings = {};
    root = signal<DirectoryListing | null>({ path: '/root', name: 'root', entries: [] });
    (window as unknown as { bridge: Bridge }).bridge = lsp;
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  describe('server questions and notices (#1154)', () => {
    /**
     * Opens a C# document, starting the Roslyn session.
     * @param client The client.
     */
    async function openCsharp(client: LspClient): Promise<void> {
      client.syncDocument({
        documentId: 'a',
        path: '/root/A.cs',
        languageId: 'csharp',
        content: '',
      });
      await flush();
    }

    const QUESTION: LspShowMessageRequest = {
      requestId: 'q1',
      sessionId: '/root::csharp',
      type: 2,
      message: 'Restore the solution?',
      actions: ['Restore', 'Not now'],
    };

    it('aQuestion_isAStickyToastWhoseButtonsAnswerIt_once', async () => {
      const client: LspClient = build();
      const notifications: Notifications = TestBed.inject(Notifications);
      await openCsharp(client);

      lsp.ask(QUESTION);
      TestBed.tick();

      const toast: Notification | undefined = notifications.toasts()[0];
      expect(toast).toMatchObject({
        severity: 'warning',
        title: 'Restore the solution?',
        sticky: true,
        key: 'lsp-question:q1',
      });
      expect(toast?.actions.map((action: NotificationAction): string => action.label)).toEqual([
        'Restore',
        'Not now',
      ]);
      expect(lsp.questionReplies).toEqual([]);
      toast?.actions[0]?.run();
      notifications.dismiss(toast?.id ?? 0);
      TestBed.tick();

      expect(lsp.questionReplies).toEqual([{ requestId: 'q1', action: 0 }]);
    });

    it('aQuestionDismissedWithoutAnAnswer_isAnsweredNull', async () => {
      const client: LspClient = build();
      const notifications: Notifications = TestBed.inject(Notifications);
      await openCsharp(client);

      lsp.ask(QUESTION);
      TestBed.tick();
      notifications.dismissByKey('lsp-question:q1');
      TestBed.tick();

      expect(lsp.questionReplies).toEqual([{ requestId: 'q1', action: null }]);
    });

    it('aQuestionForASessionThisWindowDoesNotHold_isNotAsked', async () => {
      const client: LspClient = build();
      const notifications: Notifications = TestBed.inject(Notifications);
      await openCsharp(client);

      lsp.ask({ ...QUESTION, sessionId: '/elsewhere::csharp' });
      TestBed.tick();

      expect(notifications.toasts()).toEqual([]);
      expect(lsp.questionReplies).toEqual([]);
    });

    it('anInformationMessage_showsOnTheServersRowForAFewSeconds_withoutAToast', async () => {
      const client: LspClient = build();
      const notifications: Notifications = TestBed.inject(Notifications);
      const status: LspStatus = TestBed.inject(LspStatus);
      await openCsharp(client);
      vi.useFakeTimers();
      try {
        lsp.notify('/root::csharp', 'window/showMessage', {
          type: 3,
          message: 'Solution loaded.',
        });

        expect(status.servers()[0]?.notice).toBe('Solution loaded.');
        expect(notifications.toasts()).toEqual([]);
        vi.advanceTimersByTime(NOTICE_MS);
        expect(status.servers()[0]?.notice).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('crash policy (#1136)', () => {
    let raised: NotificationRequest[];
    let shown: string[];
    let now: number;

    beforeEach(() => {
      raised = [];
      shown = [];
      now = Date.now();
      vi.spyOn(Date, 'now').mockImplementation((): number => now);
      TestBed.configureTestingModule({
        providers: [
          {
            provide: Notifications,
            useValue: {
              notify: (request: NotificationRequest): void => void raised.push(request),
            },
          },
          {
            provide: Output,
            useValue: {
              channel: (): unknown => ({ appendLine: (): void => undefined }),
              show: (id: string): void => void shown.push(id),
            },
          },
        ],
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const BASE: { documentId: string; path: string; languageId: string; content: string } = {
      documentId: 'a',
      path: '/root/A.cs',
      languageId: 'csharp',
      content: '',
    };

    /**
     * Syncs the document once the crash backoff has passed, so the session restarts.
     * @param client The client.
     */
    async function syncAfterBackoff(client: LspClient): Promise<void> {
      now += 600_000;
      client.syncDocument(BASE);
      await flush();
    }

    it('aCleanExitTwice_stopsAtTheSecond_withAToastOfferingRestartAndShowLog', async () => {
      const client: LspClient = build();
      const status: LspStatus = TestBed.inject(LspStatus);
      client.syncDocument(BASE);
      await flush();

      lsp.exit('/root::csharp', undefined, { code: 0, signal: null });
      expect(raised).toEqual([]);
      await syncAfterBackoff(client);
      expect(lsp.starts).toHaveLength(2);
      lsp.exit('/root::csharp', undefined, { code: 0, signal: null });
      await syncAfterBackoff(client);

      expect(lsp.starts).toHaveLength(2);
      expect(status.servers()[0]?.detail).toBe(
        'The server stopped the same way twice, so it was not restarted again. Restart it to try again.',
      );
      expect(raised).toHaveLength(1);
      expect(raised[0]).toMatchObject({
        severity: 'error',
        title: 'csharp stopped the same way twice and was not restarted',
        key: 'lsp-given-up:/root::csharp',
      });
      expect(raised[0]?.actions?.map((action): string => action.label)).toEqual([
        'Restart',
        'Show log',
      ]);
      raised[0]?.actions?.[1]?.run();
      expect(shown).toEqual(['lsp:csharp']);
      raised[0]?.actions?.[0]?.run();
      await flush();
      expect(lsp.starts).toHaveLength(3);
    });

    it('theSameReasonTwice_stopsAtTheSecond_namingIt', async () => {
      const client: LspClient = build();
      const status: LspStatus = TestBed.inject(LspStatus);
      client.syncDocument(BASE);
      await flush();

      lsp.exit('/root::csharp', 'Unhandled exception: boom.');
      await syncAfterBackoff(client);
      lsp.exit('/root::csharp', 'Unhandled exception: boom.');
      await syncAfterBackoff(client);

      expect(lsp.starts).toHaveLength(2);
      expect(status.servers()[0]?.detail).toBe(
        'The server stopped the same way twice, so it was not restarted again: Unhandled exception: boom. Restart it to try again.',
      );
      expect(raised[0]?.detail).toBe('Unhandled exception: boom.');
    });

    it('differentReasons_orSignals_keepTheOrdinaryBackoff', async () => {
      const client: LspClient = build();
      client.syncDocument(BASE);
      await flush();

      lsp.exit('/root::csharp', 'First.');
      await syncAfterBackoff(client);
      lsp.exit('/root::csharp', 'Second.');
      await syncAfterBackoff(client);
      lsp.exit('/root::csharp', 'Killed.', { code: null, signal: 'SIGKILL' });
      await syncAfterBackoff(client);
      lsp.exit('/root::csharp', 'Killed.', { code: null, signal: 'SIGKILL' });
      await syncAfterBackoff(client);

      expect(lsp.starts).toHaveLength(5);
      expect(raised).toEqual([]);
      lsp.exit('/root::csharp', 'Killed.', { code: null, signal: 'SIGKILL' });
      await syncAfterBackoff(client);

      expect(lsp.starts).toHaveLength(5);
      expect(raised[0]?.title).toBe('csharp crashed repeatedly and was stopped');
    });
  });

  describe('server problems as toasts (#1134)', () => {
    let raised: NotificationRequest[];
    let shown: string[];

    beforeEach(() => {
      raised = [];
      shown = [];
      TestBed.configureTestingModule({
        providers: [
          {
            provide: Notifications,
            useValue: {
              notify: (request: NotificationRequest): void => void raised.push(request),
            },
          },
          {
            provide: Output,
            useValue: {
              channel: (): unknown => ({ appendLine: (): void => undefined }),
              show: (id: string): void => void shown.push(id),
            },
          },
        ],
      });
    });

    /**
     * Opens a C# document, starting the Roslyn session.
     * @param client The client.
     */
    async function openCsharp(client: LspClient): Promise<void> {
      client.syncDocument({
        documentId: 'a',
        path: '/root/A.cs',
        languageId: 'csharp',
        content: '',
      });
      await flush();
    }

    it('roslynsToast_ofAProjectThatFailedToLoad_isRaised_withShowLogOpeningItsOutputChannel', async () => {
      const client: LspClient = build();
      await openCsharp(client);

      lsp.notify('/root::csharp', 'window/_roslyn_showToast', {
        messageType: 1,
        message: 'There were problems loading project Fixture.Core.csproj. See log for details.',
        commands: [{ title: 'Show C# logs', command: 'csharp.showOutputWindow' }],
      });

      expect(raised).toHaveLength(1);
      expect(raised[0]).toMatchObject({
        severity: 'error',
        title: 'There were problems loading project Fixture.Core.csproj.',
        detail: 'csharp',
        key: 'lsp-problem:/root::csharp',
      });
      raised[0]?.actions?.[0]?.run();
      expect(raised[0]?.actions?.[0]?.label).toBe('Show log');
      expect(shown).toEqual(['lsp:csharp']);
    });

    it('aBurst_updatesOneToastWithACountOfDistinctProblems', async () => {
      const client: LspClient = build();
      await openCsharp(client);

      for (const project of ['A', 'B', 'B', 'C']) {
        lsp.notify('/root::csharp', 'window/_roslyn_showToast', {
          messageType: 1,
          message: `There were problems loading project ${project}.csproj. See log for details.`,
        });
      }

      expect(raised.map((request: NotificationRequest): string => request.title)).toEqual([
        'There were problems loading project A.csproj.',
        'csharp reported 2 problems',
        // Roslyn repeats a failed project's report: the same problem, not a third.
        'csharp reported 2 problems',
        'csharp reported 3 problems',
      ]);
      expect(raised.at(-1)?.detail).toBe('Latest: There were problems loading project C.csproj.');
      expect(new Set(raised.map((request: NotificationRequest) => request.key)).size).toBe(1);
    });

    it('showMessageWarnings_areRaisedToo_butInformationStaysInTheLog', async () => {
      const client: LspClient = build();
      await openCsharp(client);

      lsp.notify('/root::csharp', 'window/showMessage', { type: 3, message: 'Loaded.' });
      lsp.notify('/root::csharp', 'window/_roslyn_showToast', { messageType: 3, message: 'Hi.' });
      lsp.notify('/root::csharp', 'window/showMessage', { type: 2, message: 'MSBuild is old.' });

      expect(raised).toHaveLength(1);
      expect(raised[0]).toMatchObject({ severity: 'warning', title: 'MSBuild is old.' });
    });
  });

  describe('running tests (#1150)', () => {
    let raised: NotificationRequest[];
    let lines: string[];
    let shown: string[];

    beforeEach(() => {
      raised = [];
      lines = [];
      shown = [];
      TestBed.configureTestingModule({
        providers: [
          {
            provide: Notifications,
            useValue: {
              notify: (request: NotificationRequest): void => void raised.push(request),
            },
          },
          {
            provide: Output,
            useValue: {
              channel: (): unknown => ({
                appendLine: (line: string): void => void lines.push(line),
                clear: (): void => void (lines = []),
              }),
              show: (id: string): void => void shown.push(id),
            },
          },
        ],
      });
    });

    it('aRunsLog_streamsIntoTheTestsChannel_andAFailureIsRaised_withShowLog', async () => {
      let finish: (value: unknown) => void = (): void => undefined;
      lsp.requestAnswers['textDocument/runTests'] = new Promise((resolve) => {
        finish = resolve;
      });
      const features: FakeFeatures = new FakeFeatures();
      const client: LspClient = build(features);
      client.syncDocument({
        documentId: 't',
        path: '/root/T.cs',
        languageId: 'csharp',
        content: '',
      });
      await flush();
      const lens: unknown = {
        textDocument: { uri: 'file:///root/T.cs' },
        range: { start: { line: 16, character: 16 }, end: { line: 16, character: 28 } },
        attachDebugger: false,
      };

      features.resolver?.('/root/T.cs')?.runTests?.(lens);
      await flush();
      const request: { params: unknown } | undefined = lsp.requests.at(-1);
      const token: unknown = (request?.params as { partialResultToken?: unknown })
        ?.partialResultToken;
      lsp.notify('/root::csharp', '$/progress', {
        token,
        value: { stage: 'Building project...', message: 'Build succeeded.' },
      });
      lsp.notify('/root::csharp', '$/progress', {
        token,
        value: {
          stage: 'Running tests...',
          message:
            '[Failed] Fixture.Tests.PersonTests.Create_Fails\n    Message:\n        Assert.Equal() Failure: Strings differ',
          progress: { testsPassed: 0, testsFailed: 1, testsSkipped: 0, totalTests: 1 },
        },
      });
      finish([]);
      await flush();

      expect(shown).toEqual(['lsp-tests']);
      expect(request?.params).toMatchObject({ ...(lens as object), attachDebugger: false });
      expect(lines[0]).toBe('Build succeeded.');
      expect(lines[1]).toContain('[Failed] Fixture.Tests.PersonTests.Create_Fails');
      expect(raised).toEqual([
        expect.objectContaining({
          severity: 'error',
          title: 'Create_Fails failed',
          detail: 'Assert.Equal() Failure: Strings differ',
        }),
      ]);
      raised[0]?.actions?.[0]?.run();
      expect(shown).toEqual(['lsp-tests', 'lsp-tests']);
    });

    it('aDebugLensAsksForTheDebugger_whichTheWorkspaceAttachesToTheTestHost (#1150)', async () => {
      const attached: [number, string][] = [];
      lsp.requestAnswers['textDocument/runTests'] = new Promise((): void => undefined);
      const features: FakeFeatures = new FakeFeatures();
      const client: LspClient = build(features);
      TestBed.inject(DebugAttachRouter).register(
        (processId: number, name: string): Promise<boolean> => {
          attached.push([processId, name]);
          return Promise.resolve(true);
        },
      );
      client.syncDocument({
        documentId: 't',
        path: '/root/T.cs',
        languageId: 'csharp',
        content: '',
      });
      await flush();

      features.resolver?.('/root/T.cs')?.runTests?.({
        range: { start: { line: 8, character: 16 }, end: { line: 8, character: 35 } },
        attachDebugger: true,
      });
      await flush();
      lsp.attachDebugger({ requestId: 'r1', sessionId: '/root::csharp', processId: 46456 });
      lsp.attachDebugger({ requestId: 'r2', sessionId: '/elsewhere::csharp', processId: 1 });
      await flush();

      expect(lsp.requests.at(-1)?.params).toMatchObject({ attachDebugger: true });
      expect(attached).toEqual([[46456, 'Tests']]);
      expect(lsp.attachReplies).toEqual([{ requestId: 'r1', didAttach: true }]);
      expect(lines).toContain('Attaching the debugger to the test host (process 46456).');
    });

    it('testLines_placesEachReportedTestOnItsLensesLine', () => {
      const source: readonly string[] = [
        'public class PersonTests',
        '{',
        '    public void Create_KeepsTheName()',
        '    public void Create_Fails()',
        '    public void Create_Skips()',
      ];
      const lens: (line: number, from: number, to: number) => unknown = (
        line: number,
        from: number,
        to: number,
      ): unknown => ({
        range: { start: { line, character: from }, end: { line, character: to } },
        command: { command: 'dotnet.test.run' },
      });

      const placed: Map<number, string> = testLines(
        [
          lens(0, 13, 24),
          lens(2, 16, 35),
          lens(3, 16, 28),
          lens(4, 16, 28),
          { range: { start: { line: 2, character: 16 }, end: { line: 2, character: 35 } } },
        ],
        (line: number): string => source[line - 1] ?? '',
        new Map([
          ['Fixture.Tests.PersonTests.Create_KeepsTheName', 'passed'],
          ['Fixture.Tests.PersonTests.Create_Fails', 'failed'],
          ['Fixture.Tests.PersonTests.Create_Skips', 'skipped'],
        ]),
      );

      expect([...placed]).toEqual([
        [3, 'passed'],
        [4, 'failed'],
      ]);
    });
  });

  describe('symbols across the workspace (#1146)', () => {
    /**
     * Opens a C# document, starting the Roslyn session.
     * @param client The client.
     */
    async function openCsharp(client: LspClient): Promise<void> {
      client.syncDocument({
        documentId: 'a',
        path: '/root/A.cs',
        languageId: 'csharp',
        content: '',
      });
      await flush();
    }

    it('asksEveryServerThatFindsThem_andListsWhatTheyFound', async () => {
      lsp.startResult = { success: true, capabilities: { workspaceSymbolProvider: true } };
      lsp.requestAnswers['workspace/symbol'] = [
        {
          name: 'FormalGreeter',
          kind: 5,
          location: {
            uri: 'file:///root/Services/FormalGreeter.cs',
            range: { start: { line: 4, character: 20 }, end: { line: 4, character: 33 } },
          },
          containerName: 'project Fixture.Services (net10.0)',
        },
        { name: 'Decompiled', kind: 5, location: { uri: 'csharp:/metadata/x.cs' } },
        { name: 'NoRange', kind: 12, location: { uri: 'file:///root/Util.cs' } },
      ];
      const client: LspClient = build();
      await openCsharp(client);

      const found: readonly WorkspaceSymbolMatch[] = await client.workspaceSymbols('  FoGr ');

      expect(lsp.requests.at(-1)).toEqual({
        sessionId: '/root::csharp',
        method: 'workspace/symbol',
        params: { query: 'FoGr' },
      });
      expect(found).toEqual([
        {
          name: 'FormalGreeter',
          kind: 5,
          container: 'project Fixture.Services (net10.0)',
          path: '/root/Services/FormalGreeter.cs',
          range: { startLineNumber: 5, startColumn: 21, endLineNumber: 5, endColumn: 34 },
        },
        {
          name: 'NoRange',
          kind: 12,
          container: '',
          path: '/root/Util.cs',
          range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
        },
      ]);
    });

    it('asksNothing_forNothingTyped_orWhereNoServerFindsThem', async () => {
      const client: LspClient = build();
      await openCsharp(client);
      const asked: number = lsp.requests.length;

      expect(await client.workspaceSymbols('Greeter')).toEqual([]);
      lsp.startResult = { success: true, capabilities: { workspaceSymbolProvider: true } };
      expect(await client.workspaceSymbols('   ')).toEqual([]);
      expect(lsp.requests.length).toBe(asked);
    });
  });

  describe('diagnostics for the whole workspace (#1144)', () => {
    const BROKEN: unknown = {
      uri: 'file:///root/src/Broken.cs',
      kind: 'full',
      resultId: 'r1',
      items: [
        {
          range: { start: { line: 4, character: 33 }, end: { line: 4, character: 44 } },
          severity: 1,
          message: 'Cannot implicitly convert type string to int',
          source: 'csharp',
        },
      ],
    };

    /**
     * Opens a C# document, starting the Roslyn session.
     * @param client The client.
     * @param path The document's path.
     */
    async function openCsharp(client: LspClient, path: string = '/root/src/A.cs'): Promise<void> {
      client.syncDocument({ documentId: path, path, languageId: 'csharp', content: '' });
      await flush();
    }

    it('aFileThatIsNotOpen_listsItsErrors_locatedByPath', async () => {
      const client: LspClient = build();
      await openCsharp(client);

      lsp.notify('/root::csharp', 'studio/workspaceDiagnostics', { reports: [BROKEN] });

      expect(diagnostics.emitted).toEqual([
        {
          file: 'Broken.cs',
          message: 'Cannot implicitly convert type string to int',
          severity: 'error',
          line: 5,
          column: 34,
          source: 'csharp',
          documentId: null,
          path: '/root/src/Broken.cs',
          scope: 'workspace',
        },
      ]);
    });

    it('aFileOnceOpen_isListedFromItsOwnPull_notTwice', async () => {
      const client: LspClient = build();
      await openCsharp(client);
      lsp.notify('/root::csharp', 'studio/workspaceDiagnostics', { reports: [BROKEN] });

      await openCsharp(client, '/root/src/Broken.cs');
      lsp.notify('/root::csharp', 'studio/workspaceDiagnostics', {
        reports: [{ uri: 'file:///root/src/Other.cs', kind: 'full', items: [] }],
      });

      expect(
        diagnostics.emitted.filter(
          (diagnostic: Diagnostic): boolean => diagnostic.scope === 'workspace',
        ),
      ).toEqual([]);
    });

    it('aResetBatch_dropsWhatTheSessionReportedBefore', async () => {
      const client: LspClient = build();
      await openCsharp(client);
      lsp.notify('/root::csharp', 'studio/workspaceDiagnostics', { reports: [BROKEN] });

      lsp.notify('/root::csharp', 'studio/workspaceDiagnostics', { reports: [], reset: true });

      expect(diagnostics.emitted).toEqual([]);
    });

    it('closingADocument_hasTheWorkspacePulledAfresh_forgettingIt', async () => {
      const client: LspClient = build();
      await openCsharp(client, '/root/src/Broken.cs');

      client.closeDocument('/root/src/Broken.cs');
      await flush();

      expect(lsp.notifications.slice(-2)).toEqual([
        {
          sessionId: '/root::csharp',
          method: 'textDocument/didClose',
          params: { textDocument: { uri: 'file:///root/src/Broken.cs' } },
        },
        {
          sessionId: '/root::csharp',
          method: 'studio/refreshWorkspaceDiagnostics',
          params: { uri: 'file:///root/src/Broken.cs' },
        },
      ]);
    });

    it('anUnchangedReportKeepsTheErrors_anEmptyOneClearsThem', async () => {
      const client: LspClient = build();
      await openCsharp(client);
      lsp.notify('/root::csharp', 'studio/workspaceDiagnostics', { reports: [BROKEN] });

      lsp.notify('/root::csharp', 'studio/workspaceDiagnostics', {
        reports: [{ uri: 'file:///root/src/Broken.cs', kind: 'unchanged', resultId: 'r1' }],
      });
      expect(diagnostics.emitted).toHaveLength(1);

      lsp.notify('/root::csharp', 'studio/workspaceDiagnostics', {
        reports: [{ uri: 'file:///root/src/Broken.cs', kind: 'full', resultId: 'r2', items: [] }],
      });
      expect(diagnostics.emitted).toEqual([]);
    });
  });

  describe('restore when asked first (#1143)', () => {
    let raised: NotificationRequest[];

    beforeEach(() => {
      raised = [];
      TestBed.configureTestingModule({
        providers: [
          {
            provide: Notifications,
            useValue: {
              notify: (request: NotificationRequest): void => void raised.push(request),
            },
          },
        ],
      });
    });

    /**
     * Logs Roslyn's warning for each project that has unresolved dependencies, then waits for the
     * gathered offer.
     * @param projects The project files.
     */
    async function reportUnresolved(projects: readonly string[]): Promise<void> {
      for (const project of projects) {
        lsp.notify('/root::csharp', 'window/logMessage', {
          type: 2,
          message: `[solution/open] [LanguageServerProjectLoader] Project ${project} has unresolved dependencies`,
        });
      }
      await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 1_700));
    }

    /**
     * Opens a C# document, starting the Roslyn session.
     * @param client The client.
     */
    async function openCsharp(client: LspClient): Promise<void> {
      client.syncDocument({
        documentId: 'a',
        path: '/root/A.cs',
        languageId: 'csharp',
        content: '',
      });
      await flush();
    }

    it('gathersTheProjectsALoadReports_intoOneOfferToRestoreThem_whichRestoresThem', async () => {
      serverSettings = { csharp: { 'projects.dotnet_enable_automatic_restore': false } };
      lsp.requestAnswers['workspace/_roslyn_restore'] = { success: true };
      const client: LspClient = build();
      await openCsharp(client);

      await reportUnresolved(['/root/A/A.csproj', '/root/B/B.csproj', '/root/A/A.csproj']);

      expect(raised).toHaveLength(1);
      expect(raised[0]).toMatchObject({
        severity: 'warning',
        title: '2 projects need their packages restored',
        key: 'lsp-restore:/root::csharp',
      });
      raised[0]?.actions?.[0]?.run();
      await flush();
      expect(lsp.requests.at(-1)).toEqual({
        sessionId: '/root::csharp',
        method: 'workspace/_roslyn_restore',
        params: {
          projectFilePaths: ['/root/A/A.csproj', '/root/B/B.csproj'],
          partialResultToken: expect.any(String) as unknown,
        },
      });
      expect(raised).toHaveLength(1);
    });

    it('aRestoreUnderWay_showsItsProgressInTheServersStatus_untilItIsDone', async () => {
      serverSettings = { csharp: { 'projects.dotnet_enable_automatic_restore': false } };
      let finish: (value: unknown) => void = (): void => undefined;
      lsp.requestAnswers['workspace/_roslyn_restore'] = new Promise((resolve) => {
        finish = resolve;
      });
      const client: LspClient = build();
      const status: LspStatus = TestBed.inject(LspStatus);
      const progressOf: () => string | undefined = (): string | undefined =>
        status.servers().find((server: LspServer): boolean => server.sessionId === '/root::csharp')
          ?.progress;
      await openCsharp(client);
      await reportUnresolved(['/root/A/A.csproj']);

      raised[0]?.actions?.[0]?.run();
      await flush();
      const token: unknown = (lsp.requests.at(-1)?.params as { partialResultToken?: unknown })
        ?.partialResultToken;
      lsp.notify('/root::csharp', '$/progress', {
        token,
        value: [{ stage: 'Restore', message: 'Restoring A.csproj' }],
      });

      expect(progressOf()).toBe('Restore — Restoring A.csproj');
      finish({ success: true });
      await flush();
      expect(progressOf()).toBeUndefined();
    });

    it('aRestoreThatFails_isRaisedWithItsLog', async () => {
      serverSettings = { csharp: { 'projects.dotnet_enable_automatic_restore': false } };
      lsp.requestAnswers['workspace/_roslyn_restore'] = { success: false };
      const client: LspClient = build();
      await openCsharp(client);
      await reportUnresolved(['/root/A/A.csproj']);
      expect(raised[0]?.title).toBe('A.csproj needs its packages restored');

      raised[0]?.actions?.[0]?.run();
      await flush();

      expect(raised.at(-1)).toMatchObject({
        severity: 'error',
        title: 'Restoring packages failed',
      });
      expect(raised.at(-1)?.actions?.[0]?.label).toBe('Show log');
    });

    it('offersNothing_whileTheServerRestoresByItself', async () => {
      const client: LspClient = build();
      await openCsharp(client);

      await reportUnresolved(['/root/A/A.csproj']);

      expect(raised).toEqual([]);
    });
  });

  describe('brace style (#1177)', () => {
    let global: WritableSignal<{ braceStyle: string }>;
    let overrides: WritableSignal<Record<string, { braceStyle?: string }>>;

    beforeEach(() => {
      installedServers.set(
        CATALOGUE.map((server: LspServerSummary): LspServerSummary =>
          server.id === 'csharp' ? { ...server, takesBraceStyle: true } : server,
        ),
      );
      global = signal<{ braceStyle: string }>({ braceStyle: 'kr' });
      overrides = signal<Record<string, { braceStyle?: string }>>({
        csharp: { braceStyle: 'allman' },
      });
      TestBed.configureTestingModule({
        providers: [
          {
            provide: Settings,
            useValue: {
              globalTextEditor: global,
              languageOverrides: overrides,
              resolveSettingsForLanguage: (language: string): unknown => ({
                ...global(),
                ...overrides()[language],
              }),
            },
          },
        ],
      });
    });

    /**
     * Opens a document, starting its session.
     * @param client The client.
     * @param path The document's path.
     * @param languageId Its language.
     */
    async function openDocument(
      client: LspClient,
      path: string,
      languageId: string,
    ): Promise<void> {
      client.syncDocument({ documentId: path, path, languageId, content: '' });
      await flush();
    }

    it('aServerThatTakesTheBraceStyle_isStartedWithItsLanguagesStyle_andNoOtherIs', async () => {
      const client: LspClient = build();

      await openDocument(client, '/root/src/A.cs', 'csharp');
      await openDocument(client, '/root/src/a.ts', 'typescript');

      expect(lsp.starts).toEqual([
        { sessionId: '/root::csharp', serverId: 'csharp', rootPath: '/root', braceStyle: 'allman' },
        { sessionId: '/root::typescript', serverId: 'typescript', rootPath: '/root' },
      ]);
    });

    it('aSessionPreStartedForAWorkspace_takesItsServersLanguagesStyle', async () => {
      const client: LspClient = build();

      client.prestartServer('csharp', '/root');
      await flush();

      expect(lsp.starts).toEqual([
        { sessionId: '/root::csharp', serverId: 'csharp', rootPath: '/root', braceStyle: 'allman' },
      ]);
    });

    it('changingTheStyleForItsLanguage_restartsItWithTheNewStyle_andOnlyIt', async () => {
      const client: LspClient = build();
      await openDocument(client, '/root/src/A.cs', 'csharp');
      await openDocument(client, '/root/src/a.ts', 'typescript');

      global.set({ braceStyle: 'gnu' });
      TestBed.tick();
      await flush();
      expect(lsp.restarts).toEqual([]);

      overrides.set({});
      TestBed.tick();
      await flush();

      expect(lsp.restarts).toEqual(['/root::csharp']);
      expect(lsp.restartBraceStyles).toEqual(['gnu']);
    });
  });

  describe('rename and server edits (#1015)', () => {
    let applied: WorkspaceTextEdits[];
    let outcome: WorkspaceEditOutcome;

    beforeEach(() => {
      applied = [];
      outcome = { applied: [{ path: '/root/src/a.ts', edits: 1, where: 'editor' }], skipped: [] };
      TestBed.configureTestingModule({
        providers: [
          {
            provide: WorkspaceEditApplier,
            useValue: {
              apply: (edits: WorkspaceTextEdits): Promise<WorkspaceEditOutcome> => {
                applied.push(edits);
                return Promise.resolve(outcome);
              },
            },
          },
        ],
      });
    });

    /**
     * Opens a TypeScript document, starting its session.
     * @param client The client.
     */
    async function open(client: LspClient): Promise<void> {
      client.syncDocument({
        documentId: 'doc-1',
        path: '/root/src/a.ts',
        languageId: 'typescript',
        content: 'const a = 1;',
      });
      await flush();
    }

    it('aServersEditForItsOwnSession_isAppliedByPath_andAnsweredApplied', async () => {
      const client: LspClient = build();
      await open(client);

      lsp.applyEdit('/root::typescript', {
        changes: {
          'file:///root/src/a.ts': [
            {
              range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
              newText: 'b',
            },
          ],
        },
      });
      await flush();

      expect(applied).toEqual([
        {
          files: [
            {
              path: '/root/src/a.ts',
              edits: [
                {
                  range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 8 },
                  text: 'b',
                },
              ],
            },
          ],
          refused: [],
        },
      ]);
      expect(lsp.applyEditReplies).toEqual([{ requestId: 'r1', applied: true }]);
    });

    it('anEditWithSkippedParts_isAnsweredNotApplied_namingThem', async () => {
      outcome = { applied: [], skipped: [{ path: '/elsewhere/b.ts', reason: 'It is outside.' }] };
      const client: LspClient = build();
      await open(client);

      lsp.applyEdit('/root::typescript', { changes: {} });
      await flush();

      expect(lsp.applyEditReplies).toEqual([
        { requestId: 'r1', applied: false, failureReason: '/elsewhere/b.ts: It is outside.' },
      ]);
    });

    it('anEditForAnotherClientsSession_isLeftToIt', async () => {
      build();

      lsp.applyEdit('/other::typescript', { changes: {} });
      await flush();

      expect(applied).toEqual([]);
      expect(lsp.applyEditReplies).toEqual([]);
    });

    it('documentRefs_carryHowTheSessionsServerRenames', async () => {
      lsp.startResult = {
        success: true,
        capabilities: { renameProvider: { prepareProvider: true } },
      };
      const features: FakeFeatures = new FakeFeatures();
      const client: LspClient = build(features);
      await open(client);

      expect(features.resolver?.('/root/src/a.ts')?.rename).toBe('prepare');
    });

    it('openingADocument_turnsHintsOnForItsLanguage_whenTheServerSetsThem_andARefreshAsksAgain (#1145)', async () => {
      lsp.startResult = {
        success: true,
        capabilities: { inlayHintProvider: { resolveProvider: true } },
      };
      const features: FakeFeatures = new FakeFeatures();
      const client: LspClient = build(features);
      await open(client);

      expect(features.inlayHintsEnabled).toEqual(['typescript']);
      expect(features.resolver?.('/root/src/a.ts')?.inlayHints).toEqual({ resolve: true });
      lsp.notify('/root::typescript', 'workspace/inlayHint/refresh', undefined);
      expect(features.inlayHintRefreshes).toBe(1);
    });

    it('openingADocument_turnsOnTheFoldsOccurrencesAndRangeTokensItsServerGives (#1147)', async () => {
      lsp.startResult = {
        success: true,
        capabilities: { foldingRangeProvider: true, documentHighlightProvider: true },
      };
      const features: FakeFeatures = new FakeFeatures();
      const client: LspClient = build(features);
      await open(client);

      const expected: unknown = { folding: true, highlights: true, rangeTokens: false };
      expect(features.structureEnabled).toEqual([['typescript', expected]]);
      expect(features.resolver?.('/root/src/a.ts')?.structure).toEqual(expected);
    });

    it('documentRefs_carryTheCharactersTheServerAnswersByInsertingText (#1148)', async () => {
      lsp.startResult = {
        success: true,
        capabilities: { _vs_onAutoInsertProvider: { _vs_triggerCharacters: ['/', '\n'] } },
      };
      const features: FakeFeatures = new FakeFeatures();
      const client: LspClient = build(features);
      await open(client);

      expect(features.resolver?.('/root/src/a.ts')?.autoInsertTriggers).toEqual(['/', '\n']);
    });

    it('openingADocument_turnsLensesOnWhereTheServerShowsThem_andARefreshAsksAgain (#1149)', async () => {
      lsp.startResult = {
        success: true,
        capabilities: { codeLensProvider: { resolveProvider: true } },
      };
      const features: FakeFeatures = new FakeFeatures();
      const client: LspClient = build(features);
      await open(client);

      expect(features.codeLensEnabled).toEqual(['typescript']);
      expect(features.resolver?.('/root/src/a.ts')?.codeLens).toEqual({ resolve: true });
      lsp.notify('/root::typescript', 'workspace/codeLens/refresh', undefined);
      expect(features.codeLensRefreshes).toBe(1);
    });

    it('aServerThatSetsNoHints_turnsNoneOn (#1145)', async () => {
      const features: FakeFeatures = new FakeFeatures();
      const client: LspClient = build(features);
      await open(client);

      expect(features.inlayHintsEnabled).toEqual([]);
    });

    it('documentRefs_carryWhetherTheSessionsServerFindsImplementationsAndTypes (#1142)', async () => {
      lsp.startResult = {
        success: true,
        capabilities: { implementationProvider: true },
      };
      const features: FakeFeatures = new FakeFeatures();
      const client: LspClient = build(features);
      await open(client);

      expect(features.resolver?.('/root/src/a.ts')?.navigation).toEqual({
        implementation: true,
        typeDefinition: false,
      });
    });

    it('openingADocument_turnsFormattingOnForItsLanguage_withWhatTheServerOffers (#1141)', async () => {
      lsp.startResult = {
        success: true,
        capabilities: {
          documentFormattingProvider: true,
          documentOnTypeFormattingProvider: {
            firstTriggerCharacter: '}',
            moreTriggerCharacter: [';'],
          },
        },
      };
      const features: FakeFeatures = new FakeFeatures();
      const client: LspClient = build(features);
      await open(client);

      const expected: unknown = { document: true, range: false, onTypeTriggers: ['}', ';'] };
      expect(features.formattingEnabled).toEqual([['typescript', expected]]);
      expect(features.resolver?.('/root/src/a.ts')?.formatting).toEqual(expected);
    });

    it('documentRefs_carryHowTheSessionsServerCompletes_andTheFeaturesHearOfIt (#1021)', async () => {
      lsp.startResult = {
        success: true,
        capabilities: {
          completionProvider: { triggerCharacters: ['.', ':'], resolveProvider: true },
          signatureHelpProvider: { triggerCharacters: ['('], retriggerCharacters: [','] },
        },
      };
      const features: FakeFeatures = new FakeFeatures();
      const client: LspClient = build(features);
      await open(client);

      const ref: LspDocumentRef | null | undefined = features.resolver?.('/root/src/a.ts');
      expect(ref?.completion).toEqual({ triggerCharacters: ['.', ':'], resolve: true });
      expect(ref?.signatureHelp).toEqual({ triggerCharacters: ['('], retriggerCharacters: [','] });
      expect(features.supports).toEqual([
        [
          '/root::typescript',
          {
            completion: { triggerCharacters: ['.', ':'], resolve: true },
            signatureHelp: { triggerCharacters: ['('], retriggerCharacters: [','] },
          },
        ],
      ]);
    });

    it('documentRefs_carryTheSessionsCodeActions_itsCommands_andTheDiagnosticsWithTheirCodeAndData (#1016)', async () => {
      lsp.startResult = {
        success: true,
        capabilities: {
          codeActionProvider: { resolveProvider: true },
          executeCommandProvider: { commands: ['server.fix'] },
        },
      };
      const features: FakeFeatures = new FakeFeatures();
      const client: LspClient = build(features);
      await open(client);
      const sent: unknown = {
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
        severity: 1,
        message: 'Cannot find name',
        code: 'CS0103',
        data: { id: 'server-17' },
        source: 'csharp',
      };

      lsp.publishDiagnostics('/root::typescript', 'file:///root/src/a.ts', [sent]);
      await flush();

      const ref: LspDocumentRef | null | undefined = features.resolver?.('/root/src/a.ts');
      expect(ref?.codeActions).toBe('resolve');
      expect(ref?.commands).toEqual(['server.fix']);
      expect(ref?.diagnostics).toEqual([sent]);
    });
  });

  it('pullDiagnostics_ingestsAFullReportIntoTheAggregate', async () => {
    // A pull-based server (Roslyn) answers textDocument/diagnostic instead of pushing; the client must
    // ingest that report so the error reaches the aggregate, the Error List, and the status bar.
    lsp.startResult = { success: true, capabilities: { diagnosticProvider: {} } };
    lsp.diagnosticReport = {
      kind: 'full',
      items: [
        {
          range: { start: { line: 20, character: 12 }, end: { line: 20, character: 19 } },
          severity: 1,
          message: 'Cannot implicitly convert type string to int',
        },
      ],
    };
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/Program.cs',
      languageId: 'csharp',
      content: 'int x = "Hello";',
    });
    await flush();

    expect(
      diagnostics.emitted.some((diagnostic: Diagnostic): boolean =>
        diagnostic.message.includes('Cannot implicitly convert'),
      ),
    ).toBe(true);
  });

  it('windowLogMessage_forOwnedSession_streamsIntoAPerServerOutputChannel', async () => {
    const client: LspClient = build();
    const output: Output = TestBed.inject(Output);
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/src/a.ts',
      languageId: 'typescript',
      content: 'const a = 1;',
    });
    await flush();

    lsp.logMessage('/root::typescript', 'indexing project');

    expect(output.snapshotOf('lsp:typescript')).toContain('indexing project');
    expect(
      output.channels().some((c: OutputChannelInfo): boolean => c.id === 'lsp:typescript'),
    ).toBe(true);
  });

  it('syncDocument_supportedFileInRoot_startsServerAndSendsDidOpen', async () => {
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/src/a.ts',
      languageId: 'typescript',
      content: 'const a = 1;',
    });
    await flush();

    expect(lsp.starts).toHaveLength(1);
    expect(lsp.starts[0]).toEqual({
      sessionId: '/root::typescript',
      serverId: 'typescript',
      rootPath: '/root',
    });
    const opens: { sessionId: string; params: unknown }[] = lsp.notificationsTo('didOpen');
    expect(opens).toHaveLength(1);
    expect(opens[0].params).toEqual({
      textDocument: {
        uri: 'file:///root/src/a.ts',
        languageId: 'typescript',
        version: 1,
        text: 'const a = 1;',
      },
    });
  });

  it('syncDocument_aDecompiledSourceOutsideTheRoot_joinsTheWorkspaceSession (#1133)', async () => {
    // Roslyn answers Go to Definition on a framework symbol with a file it decompiled into the
    // temporary directory; hover and further navigation inside it work only against the session that
    // asked for it.
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/tmp/x/MetadataAsSource/abc/DecompilationMetadataAsSourceFileProvider/def/IList.cs',
      languageId: 'csharp',
      content: 'public interface IList<T> { }',
    });
    await flush();

    expect(lsp.starts.map((start: LspStartRequest): string => start.sessionId)).toEqual([
      '/root::csharp',
    ]);
    expect(lsp.notificationsTo('didOpen')).toHaveLength(1);
  });

  it('syncDocument_anOrdinaryFileOutsideTheRoot_isStillIgnored', async () => {
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/elsewhere/Program.cs',
      languageId: 'csharp',
      content: 'class A { }',
    });
    await flush();

    expect(lsp.starts).toHaveLength(0);
    expect(lsp.notificationsTo('didOpen')).toHaveLength(0);
  });

  it('syncDocument_afterServerStarts_suppressesBuiltInDiagnosticsForTheLanguage', async () => {
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: '',
    });
    client.syncDocument({
      documentId: 'doc-2',
      path: '/root/b.ts',
      languageId: 'typescript',
      content: '',
    });
    await flush();

    expect(monaco.suppressed).toEqual(['typescript']);
  });

  it('syncDocument_whenServerFailsToStart_doesNotSuppressBuiltInDiagnostics', async () => {
    lsp.startResult = { success: false, error: 'no server' };
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: '',
    });
    await flush();

    expect(monaco.suppressed).toEqual([]);
    expect(lsp.notificationsTo('didOpen')).toHaveLength(0);
  });

  it('syncDocument_calledAgain_sendsDidChangeWithIncrementedVersion', async () => {
    const client: LspClient = build();
    const base: { documentId: string; path: string; languageId: string } = {
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
    };
    client.syncDocument({ ...base, content: 'a' });
    await flush();
    client.syncDocument({ ...base, content: 'ab' });
    await flush();

    const changes: { sessionId: string; params: unknown }[] = lsp.notificationsTo('didChange');
    expect(changes).toHaveLength(1);
    // The change is the minimal ranged edit ('b' appended after the existing 'a'), so it carries the
    // range incremental-sync servers require without shipping the whole document.
    expect(changes[0].params).toEqual({
      textDocument: { uri: 'file:///root/a.ts', version: 2 },
      contentChanges: [
        {
          range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } },
          text: 'b',
        },
      ],
    });
  });

  it('syncDocument_editInsideALargeDocument_sendsOnlyTheChangedSpan', async () => {
    const client: LspClient = build();
    const before: string = `class A {\n  void One() {}\n  void Two() {}\n}\n`;
    const after: string = `class A {\n  void One() {}\n  void Two2() {}\n}\n`;
    const base: { documentId: string; path: string; languageId: string } = {
      documentId: 'doc-1',
      path: '/root/A.cs',
      languageId: 'csharp',
    };
    client.syncDocument({ ...base, content: before });
    await flush();
    client.syncDocument({ ...base, content: after });
    await flush();

    const changes: { sessionId: string; params: unknown }[] = lsp.notificationsTo('didChange');
    expect(changes).toHaveLength(1);
    expect(changes[0].params).toEqual({
      textDocument: { uri: 'file:///root/A.cs', version: 2 },
      contentChanges: [
        {
          range: { start: { line: 2, character: 10 }, end: { line: 2, character: 10 } },
          text: '2',
        },
      ],
    });
  });

  it('syncDocument_startsServerOnlyOnce_forTwoDocumentsOfSameLanguage', async () => {
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'd1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: '',
    });
    client.syncDocument({
      documentId: 'd2',
      path: '/root/b.ts',
      languageId: 'typescript',
      content: '',
    });
    await flush();

    expect(lsp.starts).toHaveLength(1);
    expect(lsp.notificationsTo('didOpen')).toHaveLength(2);
  });

  it('syncDocument_javaFile_startsTheJavaServer', async () => {
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/A.java',
      languageId: 'java',
      content: 'class A {}',
    });
    await flush();

    expect(lsp.starts).toEqual([{ sessionId: '/root::java', serverId: 'java', rootPath: '/root' }]);
    expect(lsp.notificationsTo('didOpen')).toHaveLength(1);
  });

  it('syncDocument_withNoWorkspace_rootsTheServerAtTheFilesParentDirectory', async () => {
    root.set(null);
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/tmp/scratch/a.ts',
      languageId: 'typescript',
      content: 'const a = 1;',
    });
    await flush();

    expect(lsp.starts).toEqual([
      {
        sessionId: '/tmp/scratch::typescript',
        serverId: 'typescript',
        rootPath: '/tmp/scratch',
        standaloneFile: '/tmp/scratch/a.ts',
      },
    ]);
    expect(lsp.notificationsTo('didOpen')).toHaveLength(1);
  });

  it('syncDocument_outsideTheWorkspaceRoot_isIgnored', async () => {
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/elsewhere/a.ts',
      languageId: 'typescript',
      content: '',
    });
    await flush();

    expect(lsp.starts).toHaveLength(0);
  });

  it('syncDocument_whenServerDisabled_doesNotStart', async () => {
    disabledServers.add('typescript');
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: '',
    });
    await flush();

    expect(lsp.starts).toHaveLength(0);
    expect(lsp.notifications).toHaveLength(0);
  });

  it('syncDocument_unsupportedLanguage_doesNothing', async () => {
    const client: LspClient = build();
    client.syncDocument({ documentId: 'd', path: '/root/a.rb', languageId: 'ruby', content: '' });
    await flush();

    expect(lsp.starts).toHaveLength(0);
    expect(lsp.notifications).toHaveLength(0);
  });

  it('syncDocument_pathOutsideRoot_doesNothing', async () => {
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'd',
      path: '/other/a.ts',
      languageId: 'typescript',
      content: '',
    });
    await flush();

    expect(lsp.starts).toHaveLength(0);
  });

  it('syncDocument_unsavedDocument_doesNothing', async () => {
    const client: LspClient = build();
    client.syncDocument({ documentId: 'd', path: null, languageId: 'typescript', content: '' });
    await flush();

    expect(lsp.starts).toHaveLength(0);
  });

  it('publishDiagnostics_forTrackedDocument_emitsMappedDiagnostics', async () => {
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: '',
    });
    await flush();

    lsp.publishDiagnostics('/root::typescript', 'file:///root/a.ts', [
      {
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
        severity: 1,
        message: "Type 'string' is not assignable to type 'number'.",
        source: 'typescript',
      },
    ]);

    expect(diagnostics.emitted).toEqual([
      {
        file: 'a.ts',
        message: "Type 'string' is not assignable to type 'number'.",
        severity: 'error',
        line: 1,
        column: 7,
        source: 'typescript',
        documentId: 'doc-1',
        path: '/root/a.ts',
      },
    ]);
  });

  it('publishDiagnostics_forUnownedSession_isIgnored', async () => {
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: '',
    });
    await flush();

    lsp.publishDiagnostics('/elsewhere::typescript', 'file:///root/a.ts', [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'x' },
    ]);

    expect(diagnostics.emitted).toHaveLength(0);
  });

  it('closeDocument_afterOpen_sendsDidCloseAndClearsDiagnostics', async () => {
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: '',
    });
    await flush();
    lsp.publishDiagnostics('/root::typescript', 'file:///root/a.ts', [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'x' },
    ]);
    expect(diagnostics.emitted).toHaveLength(1);

    client.closeDocument('doc-1');
    await flush();

    expect(diagnostics.emitted).toHaveLength(0);
    expect(lsp.notificationsTo('didClose')).toHaveLength(1);
  });

  it('syncDocument_whenTheDocumentMovesToANewPath_closesTheOldUriAndOpensTheNew', async () => {
    // A rename (#718) or save-as re-syncs the same document under a new path. Tracking it twice left
    // the old URI open on the server, and closeDocument then closed the stale one first.
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: 'const a = 1;',
    });
    await flush();

    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/b.ts',
      languageId: 'typescript',
      content: 'const a = 1;',
    });
    await flush();

    expect(
      lsp
        .notificationsTo('didClose')
        .map(
          (n: { params: unknown }): unknown => (n.params as { textDocument: unknown }).textDocument,
        ),
    ).toEqual([{ uri: 'file:///root/a.ts' }]);
    expect(
      lsp
        .notificationsTo('didOpen')
        .map(
          (n: { params: unknown }): unknown =>
            (n.params as { textDocument: { uri: string } }).textDocument.uri,
        ),
    ).toEqual(['file:///root/a.ts', 'file:///root/b.ts']);

    client.closeDocument('doc-1');
    await flush();

    expect(
      lsp
        .notificationsTo('didClose')
        .map(
          (n: { params: unknown }): unknown => (n.params as { textDocument: unknown }).textDocument,
        ),
    ).toEqual([{ uri: 'file:///root/a.ts' }, { uri: 'file:///root/b.ts' }]);
  });

  it('restart_withOpenDocument_stopsStartsAfreshAndReopensTheDocument', async () => {
    const client: LspClient = build();
    const status: LspStatus = TestBed.inject(LspStatus);
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: 'const a = 1;',
    });
    await flush();
    expect(lsp.starts).toHaveLength(1);

    await client.restart('/root::typescript');
    await flush();

    // The main process owns the restart (a Stop would only decrement a shared refcount); the
    // client re-attaches by starting against the respawned session and re-opening its document.
    expect(lsp.restarts).toEqual(['/root::typescript']);
    expect(lsp.stops).toEqual([]);
    expect(lsp.starts).toHaveLength(2);
    expect(lsp.notificationsTo('didOpen')).toHaveLength(2);
    expect(status.servers().map((server: LspServer): string => server.sessionId)).toContain(
      '/root::typescript',
    );
  });

  it('restart_withNoOpenDocuments_restartsTheServerAndKeepsItListed', async () => {
    const client: LspClient = build();
    const status: LspStatus = TestBed.inject(LspStatus);
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: '',
    });
    await flush();
    client.closeDocument('doc-1');
    await flush();
    expect(status.servers().map((server: LspServer): string => server.sessionId)).toContain(
      '/root::typescript',
    );

    await client.restart('/root::typescript');
    await flush();

    expect(lsp.restarts).toEqual(['/root::typescript']);
    expect(lsp.starts).toHaveLength(2);
    const server: LspServer | undefined = status
      .servers()
      .find((entry: LspServer): boolean => entry.sessionId === '/root::typescript');
    expect(server).toBeDefined();
    expect(server?.state).toBe('ready');
  });

  it('publishDiagnostics_streamedRepeatedly_refreshesSemanticTokensOnlyOnTheReadyTransition', async () => {
    const features: FakeFeatures = new FakeFeatures();
    const client: LspClient = build(features);
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: '',
    });
    await flush();
    const refreshesAfterOpen: number = features.refreshes.length;

    lsp.publishDiagnostics('/root::typescript', 'file:///root/a.ts', []);
    lsp.publishDiagnostics('/root::typescript', 'file:///root/a.ts', []);
    lsp.publishDiagnostics('/root::typescript', 'file:///root/a.ts', []);

    // Only the first push transitions starting -> ready; the rest must not fan out refreshes.
    expect(features.refreshes.length).toBe(refreshesAfterOpen + 1);
    expect(features.refreshes[features.refreshes.length - 1]).toEqual(['typescript']);
  });

  it('openDocument_refreshesSemanticTokensScopedToItsOwnLanguage', async () => {
    const features: FakeFeatures = new FakeFeatures();
    const client: LspClient = build(features);
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/A.java',
      languageId: 'java',
      content: 'class A {}',
    });
    await flush();

    expect(features.refreshes).toContainEqual(['java']);
    expect(features.refreshes).not.toContainEqual(undefined);
  });

  it('servedSignal_flipsTheSessionToReady', async () => {
    const features: FakeFeatures = new FakeFeatures();
    const client: LspClient = build(features);
    const status: LspStatus = TestBed.inject(LspStatus);
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: '',
    });
    await flush();
    expect(status.stateOf('/root::typescript')).toBe('starting');

    features.served('/root::typescript');

    expect(status.stateOf('/root::typescript')).toBe('ready');
  });

  it('servedSignal_forAnUnownedSession_isIgnored', async () => {
    const features: FakeFeatures = new FakeFeatures();
    const client: LspClient = build(features);
    const status: LspStatus = TestBed.inject(LspStatus);
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: '',
    });
    await flush();

    features.served('/elsewhere::typescript');

    expect(status.stateOf('/root::typescript')).toBe('starting');
  });

  it('serverExit_keepsTheServerListedAsUnavailable_soItsRestartAffordanceSurvives', async () => {
    const client: LspClient = build();
    const status: LspStatus = TestBed.inject(LspStatus);
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: '',
    });
    await flush();
    expect(status.stateOf('/root::typescript')).toBe('starting');

    lsp.exit('/root::typescript');

    // The status-strip trigger is mounted only while a server is listed, so a crashed server must
    // stay in the list (as unavailable) rather than vanish — otherwise the whole control disappears
    // and the user has no way to restart it.
    const server: LspServer | undefined = status
      .servers()
      .find((entry: LspServer): boolean => entry.sessionId === '/root::typescript');
    expect(server?.state).toBe('unavailable');
    expect(server?.detail).toContain('stopped unexpectedly');
  });

  it('serverExit_namesTheServersOwnReason_whenItGaveOne', async () => {
    const client: LspClient = build();
    const status: LspStatus = TestBed.inject(LspStatus);
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: '',
    });
    await flush();

    lsp.exit('/root::typescript', 'didOpen received for file:///root/a.ts which is already open.');

    const server: LspServer | undefined = status
      .servers()
      .find((entry: LspServer): boolean => entry.sessionId === '/root::typescript');
    expect(server?.detail).toBe(
      'The server stopped unexpectedly: didOpen received for file:///root/a.ts which is already open. Restart it to try again.',
    );
  });

  it('projectInitializationComplete_pullsOpenDocumentsAgain_butNeverReopensThem', async () => {
    // Roslyn 5.4 treats a second didOpen for an open document as fatal and exits (code 0) — which it
    // did ~12 s after every start of a large solution. The post-load pass may only pull.
    lsp.startResult = { success: true, capabilities: { diagnosticProvider: {} } };
    lsp.diagnosticReport = { kind: 'full', items: [] };
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/Program.cs',
      languageId: 'csharp',
      content: 'class A {}',
    });
    await flush();
    expect(lsp.notificationsTo('didOpen')).toHaveLength(1);
    const sent: number = lsp.notifications.length;
    lsp.diagnosticReport = {
      kind: 'full',
      items: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          severity: 1,
          message: 'Only visible once the solution has loaded',
        },
      ],
    };

    vi.useFakeTimers();
    try {
      lsp.notify('/root::csharp', 'workspace/projectInitializationComplete', {});
      await vi.advanceTimersByTimeAsync(5000);
    } finally {
      vi.useRealTimers();
    }

    expect(lsp.notificationsTo('didOpen')).toHaveLength(1);
    expect(lsp.notifications.length).toBe(sent);
    expect(
      diagnostics.emitted.some((diagnostic: Diagnostic): boolean =>
        diagnostic.message.includes('Only visible once the solution has loaded'),
      ),
    ).toBe(true);
  });

  it('crashLoop_repeatedCrashes_backOffExponentially_thenStopForGood', async () => {
    const realNow: () => number = Date.now;
    let now: number = realNow();
    vi.spyOn(Date, 'now').mockImplementation((): number => now);
    try {
      const client: LspClient = build();
      const status: LspStatus = TestBed.inject(LspStatus);
      const base: { documentId: string; path: string; languageId: string; content: string } = {
        documentId: 'doc-1',
        path: '/root/a.ts',
        languageId: 'typescript',
        content: '',
      };
      client.syncDocument(base);
      await flush();
      expect(lsp.starts).toHaveLength(1);
      lsp.exit('/root::typescript');

      // Within the first crash's backoff no automatic respawn happens — a crashing server must not
      // be revived on the next keystroke.
      client.syncDocument(base);
      await flush();
      expect(lsp.starts).toHaveLength(1);

      // Each crash doubles the wait; past each backoff one more attempt is allowed, until the
      // CUMULATIVE cap stops the restarts for good — a server crashing once a minute never slips
      // through a rolling window.
      for (let crash: number = 1; crash < 5; crash += 1) {
        now += 5_000 * 2 ** (crash - 1) + 1;
        client.syncDocument(base);
        await flush();
        expect(lsp.starts).toHaveLength(crash + 1);
        lsp.exit('/root::typescript');
      }
      now += 600_000;
      client.syncDocument(base);
      await flush();
      expect(lsp.starts).toHaveLength(5);
      expect(status.stateOf('/root::typescript')).toBe('unavailable');
      const server: LspServer | undefined = status
        .servers()
        .find((entry: LspServer): boolean => entry.sessionId === '/root::typescript');
      expect(server?.detail).toContain('crashed repeatedly');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('crashLoop_manualRestart_clearsTheBreakerAndStartsAfresh', async () => {
    const realNow: () => number = Date.now;
    let now: number = realNow();
    vi.spyOn(Date, 'now').mockImplementation((): number => now);
    try {
      const client: LspClient = build();
      const base: { documentId: string; path: string; languageId: string; content: string } = {
        documentId: 'doc-1',
        path: '/root/a.ts',
        languageId: 'typescript',
        content: '',
      };
      for (let crash: number = 0; crash < 5; crash += 1) {
        client.syncDocument(base);
        await flush();
        lsp.exit('/root::typescript');
        now += 5_000 * 2 ** crash + 1;
      }
      client.syncDocument(base);
      await flush();
      expect(lsp.starts).toHaveLength(5);

      await client.restart('/root::typescript');
      await flush();

      expect(lsp.starts).toHaveLength(6);
      expect(lsp.notificationsTo('didOpen').length).toBeGreaterThanOrEqual(6);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('failedStart_syncingDuringTheCooldown_leavesTheRealReasonInPlace', async () => {
    // Every document sync during the cooldown used to re-register the row as "starting" (re-arming
    // the readiness watchdog) and then bail — a spinner for a server nothing was starting, followed,
    // once typing paused, by a fabricated "did not report ready in time". The failure's own reason
    // must stay on the row until a real attempt replaces it.
    lsp.startResult = {
      success: false,
      error: 'The TypeScript language server is not installed — install it in Plugins.',
    };
    const client: LspClient = build();
    const status: LspStatus = TestBed.inject(LspStatus);
    const base: { documentId: string; path: string; languageId: string; content: string } = {
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: '',
    };
    client.syncDocument(base);
    await flush();
    expect(status.stateOf('/root::typescript')).toBe('unavailable');

    client.syncDocument({ ...base, content: 'x' });
    await flush();

    expect(lsp.starts).toHaveLength(1);
    expect(status.stateOf('/root::typescript')).toBe('unavailable');
    expect(status.servers()[0].detail).toContain('not installed');
  });

  it('progress_whileStarting_isShownOnTheStatusRow_andClearsWhenEveryTokenEnds', async () => {
    const client: LspClient = build();
    const status: LspStatus = TestBed.inject(LspStatus);
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/Program.cs',
      languageId: 'csharp',
      content: '',
    });
    await flush();

    lsp.notify('/root::csharp', '$/progress', {
      token: 'load',
      value: { kind: 'begin', title: 'Loading solution' },
    });
    expect(status.servers()[0].progress).toBe('Loading solution');

    lsp.notify('/root::csharp', '$/progress', {
      token: 'load',
      value: { kind: 'report', message: 'Restoring packages', percentage: 40 },
    });
    expect(status.servers()[0].progress).toBe('Loading solution — Restoring packages — 40%');

    lsp.notify('/root::csharp', '$/progress', { token: 'load', value: { kind: 'end' } });
    expect(status.servers()[0].progress).toBeUndefined();
  });

  it('failedStart_blocksImmediateRetry_untilTheCooldownPasses', async () => {
    lsp.startResult = { success: false, error: 'no server' };
    const realNow: () => number = Date.now;
    let now: number = realNow();
    vi.spyOn(Date, 'now').mockImplementation((): number => now);
    try {
      const client: LspClient = build();
      const base: { documentId: string; path: string; languageId: string; content: string } = {
        documentId: 'doc-1',
        path: '/root/a.ts',
        languageId: 'typescript',
        content: '',
      };
      client.syncDocument(base);
      await flush();
      expect(lsp.starts).toHaveLength(1);

      // Within the cooldown: no new attempt.
      client.syncDocument(base);
      await flush();
      expect(lsp.starts).toHaveLength(1);

      // Past the cooldown: a second attempt is made.
      now += 31_000;
      client.syncDocument(base);
      await flush();
      expect(lsp.starts).toHaveLength(2);

      // Third attempt exhausts the cap; afterwards the session is blocked until a manual restart.
      now += 31_000;
      client.syncDocument(base);
      await flush();
      expect(lsp.starts).toHaveLength(3);

      now += 31_000;
      client.syncDocument(base);
      await flush();
      expect(lsp.starts).toHaveLength(3);
      const status: LspStatus = TestBed.inject(LspStatus);
      expect(status.stateOf('/root::typescript')).toBe('unavailable');

      // A manual restart clears the bookkeeping and tries again; with a document open the session
      // then waits in its starting state for the server's first useful answer.
      lsp.startResult = { success: true };
      await client.restart('/root::typescript');
      await flush();
      expect(lsp.starts).toHaveLength(4);
      expect(status.stateOf('/root::typescript')).toBe('starting');
      expect(lsp.notificationsTo('didOpen')).toHaveLength(1);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('syncDocument_languageWithNoServer_offersToInstallSupport', async () => {
    // The first-run path: no plugin installed for this language, so the client asks the prompt to
    // offer one rather than silently doing nothing.
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/main.rb',
      languageId: 'ruby',
      content: 'puts 1',
    });
    await flush();

    expect(offeredLanguages).toEqual(['ruby']);
    expect(lsp.starts).toEqual([]);
  });

  it('syncDocument_catalogueLoadedAndEmpty_doesNotRetry', async () => {
    // Uninstalling the last language server (or a fresh profile with none) leaves the catalogue
    // legitimately empty, with `ready` long since settled. Retrying on emptiness re-entered this path
    // on every microtask in an unyielding chain that froze the renderer. The client must treat a loaded
    // empty catalogue as final: one offer, no retry.
    installedServers.set([]);
    catalogueLoaded.set(true);
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: 'const a = 1;',
    });
    await flush();
    await flush();

    // The fake prompt records every offer; the real one dedupes per language, which would mask a
    // retry loop here. Exactly one call proves the client did not re-enter.
    expect(offeredLanguages).toEqual(['typescript']);
    expect(lsp.starts).toEqual([]);
  });

  it('syncDocument_catalogueNotYetLoaded_retriesOnceItLands', async () => {
    // A document opened during startup, before the catalogue arrives, must be served once it does —
    // this is the case the retry exists for.
    installedServers.set([]);
    catalogueLoaded.set(false);
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: 'const a = 1;',
    });
    installedServers.set(CATALOGUE);
    catalogueLoaded.set(true);
    await flush();

    expect(lsp.starts).toHaveLength(1);
  });

  it('notifySaved_firstReportIsABaseline_laterChangeSendsDidSave', async () => {
    // `didSave` was advertised and never sent; servers that recompute on save waited forever. The
    // first saved-text report is the baseline (the document's text on open), not a save.
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: 'const a = 1;',
    });
    await flush();
    client.notifySaved('doc-1', 'const a = 1;');
    await flush();
    expect(lsp.notificationsTo('didSave')).toHaveLength(0);

    client.notifySaved('doc-1', 'const a = 2;');
    await flush();

    const saves: { sessionId: string; params: unknown }[] = lsp.notificationsTo('didSave');
    expect(saves).toHaveLength(1);
    expect(saves[0].params).toEqual({ textDocument: { uri: 'file:///root/a.ts' } });
  });

  it('notifySaved_whenTheServerAskedForText_includesIt', async () => {
    lsp.startResult = {
      success: true,
      capabilities: { textDocumentSync: { save: { includeText: true } } },
    };
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: 'const a = 1;',
    });
    await flush();
    client.notifySaved('doc-1', 'const a = 1;');
    client.notifySaved('doc-1', 'const a = 2;');
    await flush();

    expect(lsp.notificationsTo('didSave')[0].params).toEqual({
      textDocument: { uri: 'file:///root/a.ts' },
      text: 'const a = 2;',
    });
  });

  it('syncDocument_languageWithAServer_doesNotOffer', async () => {
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: 'const a = 1;',
    });
    await flush();

    expect(offeredLanguages).toEqual([]);
  });

  it('uninstallingAServer_stopsTheSessionItWasServing', async () => {
    // Uninstalling a language server should stop it, not leave it serving until the window is next
    // reopened. A plugin removed from the sideload directory is the same situation arriving another way.
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: 'const a = 1;',
    });
    await flush();
    expect(lsp.starts).toHaveLength(1);

    installedServers.set(
      CATALOGUE.filter((server: LspServerSummary): boolean => server.id !== 'typescript'),
    );
    TestBed.tick();
    await flush();

    expect(lsp.stops).toContain('/root::typescript');
  });

  it('anUnloadedCatalogue_doesNotStopEverything', async () => {
    // Before the catalogue has loaded, an empty set means "not known yet", not "everything was
    // uninstalled"; tearing down on it would kill every session at startup.
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: 'const a = 1;',
    });
    await flush();

    catalogueLoaded.set(false);
    installedServers.set([]);
    TestBed.tick();
    await flush();

    expect(lsp.stops).toEqual([]);
  });

  it('uninstallingTheOnlyServer_stopsItsSessionAndReOffersSupport', async () => {
    // The teardown used to gate on "the installed set is non-empty" as its loaded check, so
    // uninstalling the only installed server — which leaves the set legitimately empty — skipped the
    // teardown and the old process kept serving, with no offer to reinstall.
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: 'const a = 1;',
    });
    await flush();
    expect(offeredLanguages).toEqual([]);

    installedServers.set([]);
    TestBed.tick();
    await flush();

    expect(lsp.stops).toEqual(['/root::typescript']);
    expect(offeredLanguages).toEqual(['typescript']);
  });
});
