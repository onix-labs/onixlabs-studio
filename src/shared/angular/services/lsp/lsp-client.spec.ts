import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import {
  LspChannel,
  LspSettings as LspSettingsData,
  LspStartRequest,
  LspStartResult,
} from '@shared/api/lsp-channels';
import { DirectoryListing } from '@shared/api/workspace-channels';
import { Diagnostic, Diagnostics, DiagnosticsProvider } from '../diagnostics/diagnostics';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { LspClient } from './lsp-client';
import { LspSettings } from '@shared/angular/services/lsp-settings/lsp-settings';
import { LspServer, LspStatus } from './lsp-status';

/**
 * A fake transport that records what the client sends over the LSP channels and lets the test push
 * server notifications and exits back through the captured listeners.
 */
class FakeLsp implements Bridge {
  public readonly starts: LspStartRequest[] = [];
  public readonly notifications: { sessionId: string; method: string; params: unknown }[] = [];
  public readonly stops: string[] = [];
  public startResult: LspStartResult = { success: true };
  private notificationListener: ((...args: unknown[]) => void) | null = null;
  private exitListener: ((...args: unknown[]) => void) | null = null;

  public invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    switch (channel) {
      case LspChannel.Start as string:
        this.starts.push(args[0] as LspStartRequest);
        return Promise.resolve(this.startResult as T);
      case LspChannel.Stop as string:
        this.stops.push(args[0] as string);
        return Promise.resolve(undefined as T);
      case LspChannel.GetSettings as string:
        return Promise.resolve({
          disabledServers: [],
          javaPath: null,
          dotnetPath: null,
          clangdPath: null,
          typescriptServerPath: null,
          serverArgs: {},
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

  public exit(sessionId: string): void {
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

  /**
   * Builds the client under test with the fakes wired in.
   * @returns Returns the client.
   */
  function build(): LspClient {
    TestBed.configureTestingModule({
      providers: [
        LspClient,
        { provide: Diagnostics, useValue: diagnostics },
        { provide: Monaco, useValue: monaco },
        { provide: Workspace, useValue: { root } },
        {
          provide: LspSettings,
          useValue: { isDisabled: (serverId: string): boolean => disabledServers.has(serverId) },
        },
      ],
    });
    return TestBed.inject(LspClient);
  }

  beforeEach(() => {
    lsp = new FakeLsp();
    diagnostics = new FakeDiagnostics();
    monaco = new FakeMonaco();
    disabledServers = new Set<string>();
    root = signal<DirectoryListing | null>({ path: '/root', name: 'root', entries: [] });
    (window as unknown as { bridge: Bridge }).bridge = lsp;
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
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
    // The change replaces the whole previous document ('a', ending at line 0 character 1) with the new
    // text, so it carries the range incremental-sync servers require.
    expect(changes[0].params).toEqual({
      textDocument: { uri: 'file:///root/a.ts', version: 2 },
      contentChanges: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          text: 'ab',
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

    expect(lsp.stops).toEqual(['/root::typescript']);
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

    expect(lsp.stops).toEqual(['/root::typescript']);
    expect(lsp.starts).toHaveLength(2);
    const server: LspServer | undefined = status
      .servers()
      .find((entry: LspServer): boolean => entry.sessionId === '/root::typescript');
    expect(server).toBeDefined();
    expect(server?.state).toBe('ready');
  });
});
