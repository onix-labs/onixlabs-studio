import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { LspExit, LspMessage, LspStartResult } from '@shared/api/lsp-channels';

/**
 * A handler the manager registered on the IPC bus.
 */
type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

const handlers: Map<string, IpcHandler> = new Map<string, IpcHandler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: IpcHandler): void => void handlers.set(channel, handler),
    on: (channel: string, handler: IpcHandler): void => void handlers.set(channel, handler),
  },
}));

const { LspChannel } = await import('@shared/api/lsp-channels');
const { LspManager } = await import('./lsp-manager');
const { WorkspaceContext } = await import('../workspace-context');
type Manager = InstanceType<typeof LspManager>;
type Context = InstanceType<typeof WorkspaceContext>;
type LspServerRegistry = import('./lsp-server-registry').LspServerRegistry;
type LspResolution = import('./lsp-server-registry').LspResolution;

/**
 * A language server small enough to read: answers `initialize` and `shutdown`, writes its pid to a file,
 * and misbehaves as its first argument says.
 */
const SERVER: string = `
const fs = require('node:fs');
const mode = process.argv[2];
const pids = process.argv[3];
fs.appendFileSync(pids, process.pid + '\\n');
if (mode === 'crash-on-start') {
  process.stderr.write('fatal: the sky fell\\n');
  process.exit(3);
}
const write = (message) => {
  const body = JSON.stringify(Object.assign({ jsonrpc: '2.0' }, message));
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\\r\\n\\r\\n' + body);
};
let buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf('\\r\\n\\r\\n');
    if (end === -1) return;
    const length = Number(/Content-Length: (\\d+)/.exec(buffer.toString('utf8', 0, end))[1]);
    if (buffer.length < end + 4 + length) return;
    const message = JSON.parse(buffer.toString('utf8', end + 4, end + 4 + length));
    buffer = buffer.subarray(end + 4 + length);
    handle(message);
  }
});
function handle(message) {
  if (message.method === 'initialize' && mode !== 'hang') {
    write({ id: message.id, result: { capabilities: { hoverProvider: true }, serverInfo: { name: 'fake' } } });
  } else if (message.method === 'initialized' && mode === 'crash-after-start') {
    process.stderr.write('fatal: lost the plot\\n');
    process.exit(7);
  } else if (message.method === 'initialized' && mode === 'chatty') {
    write({ method: 'telemetry/event', params: {} });
    write({ method: 'textDocument/publishDiagnostics', params: { uri: 'file:///a', diagnostics: [] } });
  } else if (message.method === 'initialized' && mode === 'file-status') {
    write({ method: 'textDocument/clangd.fileStatus', params: { uri: 'file:///a', state: 'idle' } });
  } else if (message.method === 'initialized' && mode === 'closes-stdout') {
    fs.closeSync(1);
  } else if (message.method === 'shutdown' && mode !== 'ignores-shutdown') {
    write({ id: message.id, result: null });
  } else if (message.method === 'exit') {
    process.exit(0);
  } else if (message.method === 'echo/request') {
    write({ id: message.id, result: message.params });
  }
}
setInterval(() => undefined, 1000);
`;

/**
 * A renderer recording what it is sent.
 */
class FakeRenderer extends EventEmitter {
  public readonly sent: { channel: string; payload: unknown }[] = [];
  public destroyed: boolean = false;

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload });
  }

  public destroy(): void {
    this.destroyed = true;
    this.emit('destroyed');
  }

  public exits(): LspExit[] {
    return this.sent
      .filter(
        (entry: { channel: string }): boolean => entry.channel === String(LspChannel.ServerExit),
      )
      .map((entry: { payload: unknown }): LspExit => entry.payload as LspExit);
  }

  public notifications(): string[] {
    return this.sent
      .filter(
        (entry: { channel: string }): boolean => entry.channel === String(LspChannel.Notification),
      )
      .map((entry: { payload: unknown }): string => (entry.payload as LspMessage).method);
  }
}

/**
 * Whether a process is alive.
 * @param pid The process.
 * @returns Returns true while it runs.
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Waits for a condition.
 * @param condition The condition.
 * @param what What is being waited for, for the failure message.
 */
async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline: number = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 10));
  }
}

describe.skipIf(process.platform === 'win32')('LspManager sessions', () => {
  let scratch: string = '';
  let root: string = '';
  let pids: string = '';
  let script: string = '';
  let workspace: Context;
  let manager: Manager;
  let mode: string = 'normal';
  let command: string = process.execPath;
  // Holds the resolution back, while a spec does something mid-flight.
  let gate: Promise<void> = Promise.resolve();

  /**
   * Reads every server process started so far.
   * @returns Returns the process ids.
   */
  async function started(): Promise<number[]> {
    const { readFile } = await import('node:fs/promises');
    const text: string = await readFile(pids, 'utf8').catch((): string => '');
    return text
      .split('\n')
      .filter((line: string): boolean => line.length > 0)
      .map(Number);
  }

  /**
   * Invokes a handler the renderer would.
   * @param channel The channel.
   * @param sender The renderer invoking it.
   * @param args The arguments.
   * @returns Returns the handler's answer.
   */
  function invoke(channel: string, sender: FakeRenderer, ...args: unknown[]): Promise<unknown> {
    const handler: IpcHandler | undefined = handlers.get(channel);
    if (handler === undefined) {
      throw new Error(`Nothing handles ${channel}`);
    }
    return Promise.resolve(handler({ sender }, ...args));
  }

  /**
   * Starts a session.
   * @param sender The renderer starting it.
   * @param overrides What differs from the default request.
   * @returns Returns the outcome.
   */
  function start(
    sender: FakeRenderer,
    overrides: Record<string, unknown> = {},
  ): Promise<LspStartResult> {
    const request: Record<string, unknown> = Object.assign(
      { sessionId: 'session', serverId: 'fake', rootPath: root },
      overrides,
    );
    return invoke(LspChannel.Start, sender, request) as Promise<LspStartResult>;
  }

  /**
   * Sends a notification as a renderer would.
   * @param sender The renderer.
   * @param args The session, method and parameters.
   */
  function notify(sender: FakeRenderer, ...args: unknown[]): void {
    handlers.get(LspChannel.Notify)?.({ sender }, ...args);
  }

  beforeEach(() => {
    scratch = mkdtempSync(path.join(tmpdir(), 'studio-lsp-sessions-'));
    root = path.join(scratch, 'workspace');
    mkdirSync(root);
    pids = path.join(scratch, 'pids');
    script = path.join(scratch, 'server.cjs');
    writeFileSync(script, SERVER);
    mode = 'normal';
    command = process.execPath;
    gate = Promise.resolve();
    handlers.clear();
    workspace = new WorkspaceContext();
    workspace.addRoot(root);
    const registry: unknown = {
      resolve: async (): Promise<LspResolution> => {
        await gate;
        return { spec: { command, args: [script, mode, pids] }, error: null };
      },
      pushedSettingsOf: (): undefined => undefined,
      pullsSettings: (): boolean => true,
      servesWorkspaceDiagnostics: (): boolean => false,
      projectDiagnosticsOf: (): undefined => undefined,
      configurationOf: (): undefined => undefined,
      catalogue: (): unknown[] => [{ id: 'fake' }],
      onConfigurationChange: (): void => undefined,
    };
    manager = new LspManager(
      (): BrowserWindow | null => null,
      workspace,
      registry as LspServerRegistry,
    );
    manager.register();
  });

  afterEach(async () => {
    vi.useRealTimers();
    manager.disposeAll();
    for (const pid of await started()) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
    rmSync(scratch, { recursive: true, force: true });
  });

  describe('start', () => {
    it('runsTheHandshake_andReturnsTheServersCapabilities', async () => {
      const result: LspStartResult = await start(new FakeRenderer());

      expect(result).toMatchObject({
        success: true,
        serverInfo: { name: 'fake' },
        capabilities: { hoverProvider: true },
      });
    });

    it('aSecondStartOnARunningSession_sharesTheServerAndItsCapabilities', async () => {
      await start(new FakeRenderer());

      const second: LspStartResult = await start(new FakeRenderer());

      expect(second).toMatchObject({ success: true, capabilities: { hoverProvider: true } });
      expect(await started()).toHaveLength(1);
    });

    it('twoStartsInFlightTogether_spawnOneServer_soNoneIsOrphaned', async () => {
      const results: LspStartResult[] = await Promise.all([
        start(new FakeRenderer()),
        start(new FakeRenderer()),
      ]);

      expect(results.map((result: LspStartResult): boolean => result.success)).toEqual([
        true,
        true,
      ]);
      expect(await started()).toHaveLength(1);
    });

    it('aServerThatCannotBeSpawned_failsTheStart_atOnce', async () => {
      command = path.join(scratch, 'no-such-server');

      const result: LspStartResult = await start(new FakeRenderer());

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/ENOENT/);
    });

    it('aServerThatDiesOnStart_failsTheStart_andARetryCanSucceed', async () => {
      mode = 'crash-on-start';
      const renderer: FakeRenderer = new FakeRenderer();

      expect((await start(renderer)).success).toBe(false);
      await until((): boolean => renderer.exits().length > 0, 'the exit report');
      expect(renderer.exits()[0]).toMatchObject({
        code: 3,
        reason: expect.stringContaining('fatal') as unknown,
      });

      mode = 'normal';
      expect((await start(renderer)).success).toBe(true);
    });

    it('aServerThatNeverAnswers_isTornDownAfterTheTimeout', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      mode = 'hang';

      const outcome: Promise<LspStartResult> = start(new FakeRenderer());
      await vi.advanceTimersByTimeAsync(60_000);

      expect(await outcome).toEqual({ success: false, error: 'Timed out' });
    });

    it.each<[string, unknown]>([
      ['nothing', undefined],
      ['aString', 'start'],
      ['null', null],
      ['noSessionId', { serverId: 'fake', rootPath: '/r' }],
      ['anEmptySessionId', { sessionId: '', serverId: 'fake', rootPath: '/r' }],
      ['aNonStringServerId', { sessionId: 's', serverId: 4, rootPath: '/r' }],
      ['anEmptyRoot', { sessionId: 's', serverId: 'fake', rootPath: '' }],
      ['aNonStringFile', { sessionId: 's', serverId: 'fake', rootPath: '/r', standaloneFile: 1 }],
    ])('refuses_%s', async (_name: string, request: unknown) => {
      const result: unknown = await invoke(LspChannel.Start, new FakeRenderer(), request);

      expect(result).toEqual({ success: false, error: 'Invalid start request' });
      expect(await started()).toHaveLength(0);
    });

    it('reportsAnUnavailableServer_withTheRegistrysReason', async () => {
      const refusing: unknown = {
        resolve: (): Promise<LspResolution> =>
          Promise.resolve({ spec: null, error: 'Java 21+ runtime not found' }),
      };
      const other: Manager = new LspManager(
        (): BrowserWindow | null => null,
        workspace,
        refusing as LspServerRegistry,
      );
      const internal: { start(request: unknown, sender: unknown): Promise<LspStartResult> } =
        other as unknown as { start(request: unknown, sender: unknown): Promise<LspStartResult> };

      const result: LspStartResult = await internal.start(
        { sessionId: 's', serverId: 'java', rootPath: root },
        new FakeRenderer(),
      );

      expect(result).toEqual({ success: false, error: 'Java 21+ runtime not found' });
    });
  });

  describe('confinement', () => {
    it('refusesARootThatIsNotOpen', async () => {
      const outside: string = path.join(scratch, 'outside');
      mkdirSync(outside);

      const result: LspStartResult = await start(new FakeRenderer(), { rootPath: outside });

      expect(result).toEqual({ success: false, error: 'Workspace root is not open' });
      expect(await started()).toHaveLength(0);
    });

    it('allowsTheFolderOfARealStandaloneFile', async () => {
      const folder: string = path.join(scratch, 'loose');
      mkdirSync(folder);
      writeFileSync(path.join(folder, 'note.ts'), '');

      const result: LspStartResult = await start(new FakeRenderer(), {
        rootPath: folder,
        standaloneFile: path.join(folder, 'note.ts'),
      });

      expect(result.success).toBe(true);
    });

    it.each<[string, (folder: string) => string]>([
      ['aFileThatIsNotThere', (folder: string): string => path.join(folder, 'gone.ts')],
      ['aDirectory', (folder: string): string => folder],
      ['aFileInADeeperFolder', (folder: string): string => path.join(folder, 'deep', 'x.ts')],
      ['aTraversalOutOfTheFolder', (folder: string): string => path.join(folder, '..', 'x.ts')],
    ])('refusesARootJustifiedBy_%s', async (_name: string, file: (folder: string) => string) => {
      const folder: string = path.join(scratch, 'loose');
      mkdirSync(path.join(folder, 'deep'), { recursive: true });
      writeFileSync(path.join(folder, 'deep', 'x.ts'), '');
      writeFileSync(path.join(scratch, 'x.ts'), '');

      const result: LspStartResult = await start(new FakeRenderer(), {
        rootPath: folder,
        standaloneFile: file(folder),
      });

      expect(result).toEqual({ success: false, error: 'Workspace root is not open' });
    });
  });

  describe('reference counting', () => {
    it('stoppingOneOfTwoHolders_keepsTheServer_andStoppingTheLast_endsIt', async () => {
      const first: FakeRenderer = new FakeRenderer();
      const second: FakeRenderer = new FakeRenderer();
      await start(first);
      await start(second);
      const [pid]: number[] = await started();

      await invoke(LspChannel.Stop, first, 'session');
      expect(alive(pid)).toBe(true);
      expect(await invoke(LspChannel.Request, first, 'session', 'echo/request', { n: 1 })).toEqual({
        n: 1,
      });

      await invoke(LspChannel.Stop, second, 'session');
      await until((): boolean => !alive(pid), 'the server to exit');
      await expect(
        invoke(LspChannel.Request, first, 'session', 'echo/request', {}),
      ).rejects.toThrow('No such session');
    });

    it('aDestroyedRenderer_releasesItsHold_soTheServerEnds', async () => {
      const renderer: FakeRenderer = new FakeRenderer();
      await start(renderer);
      const [pid]: number[] = await started();

      renderer.destroy();

      await until((): boolean => !alive(pid), 'the server to exit');
    });

    it('aDestroyedRenderer_leavesAServerAnotherStillHolds', async () => {
      const gone: FakeRenderer = new FakeRenderer();
      const kept: FakeRenderer = new FakeRenderer();
      await start(gone);
      await start(kept);
      const [pid]: number[] = await started();

      gone.destroy();

      expect(await invoke(LspChannel.Request, kept, 'session', 'echo/request', { n: 1 })).toEqual({
        n: 1,
      });
      expect(alive(pid)).toBe(true);
    });

    it('stoppingASessionThatIsNotThere_isQuiet', async () => {
      await expect(invoke(LspChannel.Stop, new FakeRenderer(), 'nope')).resolves.toBeUndefined();
      await expect(invoke(LspChannel.Stop, new FakeRenderer(), 7)).resolves.toBeUndefined();
    });

    it('aServerThatIgnoresShutdown_isKilledAfterTheGrace', async () => {
      mode = 'ignores-shutdown';
      const renderer: FakeRenderer = new FakeRenderer();
      await start(renderer);
      const [pid]: number[] = await started();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      const stopped: Promise<unknown> = invoke(LspChannel.Stop, renderer, 'session');
      await vi.advanceTimersByTimeAsync(3_000);
      await stopped;
      vi.useRealTimers();

      await until((): boolean => !alive(pid), 'the server to be killed');
    });
  });

  describe('a server crashing', () => {
    it('tellsItsHolders_withTheExitAndItsLastWords_andEndsTheSession', async () => {
      mode = 'crash-after-start';
      const renderer: FakeRenderer = new FakeRenderer();

      await start(renderer);
      await until((): boolean => renderer.exits().length > 0, 'the exit report');

      expect(renderer.exits()).toEqual([
        {
          sessionId: 'session',
          code: 7,
          signal: null,
          reason: expect.stringContaining('lost the plot') as unknown,
        },
      ]);
      await expect(invoke(LspChannel.Request, renderer, 'session', 'x', {})).rejects.toThrow(
        'No such session',
      );
    });

    it('aKillFromOutside_isReportedByItsSignal', async () => {
      const renderer: FakeRenderer = new FakeRenderer();
      await start(renderer);
      const [pid]: number[] = await started();

      process.kill(pid, 'SIGKILL');
      await until((): boolean => renderer.exits().length > 0, 'the exit report');

      expect(renderer.exits()[0]).toMatchObject({ code: null, signal: 'SIGKILL' });
    });

    it('anExitTheManagerAskedFor_isNotReportedAsACrash', async () => {
      const renderer: FakeRenderer = new FakeRenderer();
      await start(renderer);
      const [pid]: number[] = await started();

      await invoke(LspChannel.Stop, renderer, 'session');
      await until((): boolean => !alive(pid), 'the server to exit');

      expect(renderer.exits()).toEqual([]);
    });

    it('aNotificationToAServerThatClosedItsOutput_doesNotThrowIntoTheIpcHandler', async () => {
      mode = 'closes-stdout';
      const renderer: FakeRenderer = new FakeRenderer();
      await start(renderer);
      await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 200));

      expect((): void => notify(renderer, 'session', 'textDocument/didChange', {})).not.toThrow();
    });
  });

  describe('restart', () => {
    it('replacesTheProcess_underTheSameSession_andTellsItsHolders', async () => {
      const renderer: FakeRenderer = new FakeRenderer();
      await start(renderer);
      const [before]: number[] = await started();

      const result: unknown = await invoke(LspChannel.Restart, renderer, 'session');

      expect(result).toMatchObject({ success: true, capabilities: { hoverProvider: true } });
      await until((): boolean => !alive(before), 'the old server to exit');
      expect(renderer.exits()).toEqual([
        { sessionId: 'session', code: null, signal: null, restarted: true },
      ]);
      expect(
        await invoke(LspChannel.Request, renderer, 'session', 'echo/request', { n: 2 }),
      ).toEqual({ n: 2 });
    });

    it('theOldServersLateExit_doesNotEndTheNewServer', async () => {
      const renderer: FakeRenderer = new FakeRenderer();
      await start(renderer);
      const [before]: number[] = await started();

      await invoke(LspChannel.Restart, renderer, 'session');
      await until((): boolean => !alive(before), 'the old server to exit');
      await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 50));

      expect(renderer.exits().filter((exit: LspExit): boolean => exit.restarted !== true)).toEqual(
        [],
      );
      expect(
        await invoke(LspChannel.Request, renderer, 'session', 'echo/request', { n: 3 }),
      ).toEqual({ n: 3 });
    });

    it('twoRestartsTogether_leaveOneServerRunning', async () => {
      const renderer: FakeRenderer = new FakeRenderer();
      await start(renderer);

      await Promise.all([
        invoke(LspChannel.Restart, renderer, 'session'),
        invoke(LspChannel.Restart, renderer, 'session'),
      ]);
      const all: number[] = await started();
      await until(
        (): boolean => all.filter((pid: number): boolean => alive(pid)).length <= 1,
        'one server left',
      );

      expect(all.filter((pid: number): boolean => alive(pid))).toHaveLength(1);
    });

    it('refusesASessionThatIsNotThere_andAMalformedBraceStyle', async () => {
      const renderer: FakeRenderer = new FakeRenderer();

      expect(await invoke(LspChannel.Restart, renderer, 'nope')).toEqual({
        success: false,
        error: 'No such session',
      });
      expect(await invoke(LspChannel.Restart, renderer, 'nope', 'whitesmiths')).toEqual({
        success: false,
        error: 'Invalid restart request',
      });
      expect(await invoke(LspChannel.Restart, renderer, 3)).toEqual({
        success: false,
        error: 'Invalid restart request',
      });
    });
  });

  describe('messages', () => {
    it('forwardsOnlyTheNotificationsTheRendererHandles', async () => {
      mode = 'chatty';
      const renderer: FakeRenderer = new FakeRenderer();

      await start(renderer);
      await until((): boolean => renderer.notifications().length > 0, 'a notification');

      expect(renderer.notifications()).toEqual(['textDocument/publishDiagnostics']);
    });

    it('forwardsClangdsFileStatus', async () => {
      mode = 'file-status';
      const renderer: FakeRenderer = new FakeRenderer();

      await start(renderer);
      await until((): boolean => renderer.notifications().length > 0, 'a notification');

      expect(renderer.notifications()).toEqual(['textDocument/clangd.fileStatus']);
    });

    it('deliversToEveryWindowHoldingTheSession', async () => {
      mode = 'chatty';
      const first: FakeRenderer = new FakeRenderer();
      const second: FakeRenderer = new FakeRenderer();
      await Promise.all([start(first)]);
      await until((): boolean => first.notifications().length > 0, 'a notification');
      await start(second);

      notify(first, 'session', 'textDocument/didChange', {});
      expect(second.notifications()).toEqual([]);
      expect(first.notifications()).toHaveLength(1);
    });

    it.each<[string, unknown[]]>([
      ['aNonStringSession', [1, 'm', {}]],
      ['aNonStringMethod', ['session', 2, {}]],
      ['anEmptyMethod', ['session', '', {}]],
      ['anUnknownSession', ['nope', 'm', {}]],
    ])('aRequestWith_%s_isRefused', async (_name: string, args: unknown[]) => {
      await start(new FakeRenderer());

      await expect(invoke(LspChannel.Request, new FakeRenderer(), ...args)).rejects.toThrow();
    });

    it.each<[string, unknown[]]>([
      ['aNonStringSession', [1, 'm', {}]],
      ['aNonStringMethod', ['session', 2, {}]],
      ['anUnknownSession', ['nope', 'm', {}]],
    ])('aNotificationWith_%s_isIgnored', async (_name: string, args: unknown[]) => {
      await start(new FakeRenderer());

      expect((): void => notify(new FakeRenderer(), ...args)).not.toThrow();
    });
  });

  describe('shutdown', () => {
    it('disposeAll_endsEveryServer', async () => {
      await start(new FakeRenderer(), { sessionId: 'a' });
      await start(new FakeRenderer(), { sessionId: 'b' });
      const servers: number[] = await started();

      manager.disposeAll();

      await until(
        (): boolean => servers.every((pid: number): boolean => !alive(pid)),
        'the servers to exit',
      );
    });

    it('aStartStillResolvingWhenStudioQuits_spawnsNothing', async () => {
      let release: () => void = (): void => undefined;
      gate = new Promise<void>((resolve: () => void): void => {
        release = resolve;
      });
      const outcome: Promise<LspStartResult> = start(new FakeRenderer());
      await Promise.resolve();

      manager.disposeAll();
      release();

      expect((await outcome).success).toBe(false);
      expect(await started()).toHaveLength(0);
    });

    it('aStartAfterDisposeAll_works_asARendererReloadedAfterACrashStartsAgain', async () => {
      await start(new FakeRenderer());
      manager.disposeAll();

      expect((await start(new FakeRenderer())).success).toBe(true);
    });
  });

  it('servesTheCatalogueFromTheRegistry', async () => {
    expect(await invoke(LspChannel.GetCatalogue, new FakeRenderer())).toEqual([{ id: 'fake' }]);
  });
});
