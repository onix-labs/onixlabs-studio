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
} from '@shared/api/lsp-channels';

import { DirectoryListing } from '@shared/api/workspace-channels';
import { Diagnostic, Diagnostics, DiagnosticsProvider } from '../diagnostics/diagnostics';
import { Output, OutputChannelInfo } from '../output/output';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { LspClient } from './lsp-client';
import { LspFeatures } from './lsp-features';
import { LspSettings } from '@shared/angular/services/lsp-settings/lsp-settings';
import { LanguageSupportPrompt } from '@shared/angular/services/plugins/language-support-prompt';
import { LspServer, LspStatus } from './lsp-status';

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
  /**
   * The sessions the (fake) main process currently has running: a successful Start adds one, a stop
   * or an exit removes it, and a Restart of anything else answers "No such session" as the real one
   * does.
   */
  public readonly running: Set<string> = new Set<string>();
  public startResult: LspStartResult = { success: true };
  public diagnosticReport: unknown = null;
  private notificationListener: ((...args: unknown[]) => void) | null = null;
  private exitListener: ((...args: unknown[]) => void) | null = null;

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
        if (!this.running.has(sessionId)) {
          return Promise.resolve({ success: false, error: 'No such session' } as T);
        }
        // The real main process respawns under the same id and tells every holder through a
        // restarted exit; the holders re-attach as they re-open.
        this.exitListener?.({ sessionId, code: null, signal: null, restarted: true });
        return Promise.resolve(this.startResult as T);
      }
      case LspChannel.Request as string:
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
          clangdPath: null,
          typescriptServerPath: null,
          serverArgs: {},
          languageServers: {},
        } as LspSettingsData as T);
      case LspChannel.SetSettings as string:
        return Promise.resolve(args[0] as T);
      default:
        return Promise.resolve(null as T);
    }
  }

  public send(channel: string, ...args: unknown[]): void {
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
    if (channel === (LspChannel.ServerExit as string)) {
      this.exitListener = listener;
      return (): void => {
        this.exitListener = null;
      };
    }
    return (): void => undefined;
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

  public exit(sessionId: string): void {
    this.running.delete(sessionId);
    this.exitListener?.({ sessionId, code: 1, signal: null });
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

  public registerDocuments(): () => void {
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
    root = signal<DirectoryListing | null>({ path: '/root', name: 'root', entries: [] });
    (window as unknown as { bridge: Bridge }).bridge = lsp;
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
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

  it('anEmptyCatalogue_doesNotStopEverything', async () => {
    // Empty means "not loaded yet", not "everything was uninstalled"; tearing down on it would kill
    // every session at startup.
    const client: LspClient = build();
    client.syncDocument({
      documentId: 'doc-1',
      path: '/root/a.ts',
      languageId: 'typescript',
      content: 'const a = 1;',
    });
    await flush();

    installedServers.set([]);
    TestBed.tick();
    await flush();

    expect(lsp.stops).toEqual([]);
  });
});
