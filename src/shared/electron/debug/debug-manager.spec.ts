import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type {
  DebugAdapterExit,
  DebugEventMessage,
  DebugRunInTerminalRequest,
  DebugStartResult,
} from '@shared/api/debug-channels';

/**
 * A handler the manager registered on the IPC bus.
 */
type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

const handlers: Map<string, IpcHandler> = new Map<string, IpcHandler>();

vi.mock('electron', () => ({
  app: { getPath: (): string => tmpdir() },
  ipcMain: {
    handle: (channel: string, handler: IpcHandler): void => void handlers.set(channel, handler),
  },
}));

const { DebugChannel } = await import('@shared/api/debug-channels');
const { DebugManager } = await import('./debug-manager');
const { WorkspaceContext } = await import('../workspace-context');
type DebugAdapterRegistry = import('./debug-adapter-registry').DebugAdapterRegistry;
type DebugAdapterResolution = import('./debug-adapter-registry').DebugAdapterResolution;

/**
 * A debug adapter small enough to read, speaking DAP on its standard streams, recording its pid, and
 * misbehaving as its first argument says.
 */
const ADAPTER: string = `
const fs = require('node:fs');
const mode = process.argv[2];
fs.appendFileSync(process.argv[3], process.pid + '\\n');
let seq = 1;
const write = (message) => {
  const body = JSON.stringify(Object.assign({ seq: seq++ }, message));
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\\r\\n\\r\\n' + body);
};
const respond = (request, body) =>
  write({ type: 'response', request_seq: request.seq, success: true, command: request.command, body });
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
  if (message.command === 'initialize') {
    if (mode === 'crash-on-initialize') process.exit(9);
    if (mode === 'hang') return;
    respond(message, { supportsConfigurationDoneRequest: true });
    write({ type: 'event', event: 'initialized' });
  } else if (message.command === 'disconnect') {
    if (mode === 'ignores-disconnect') return;
    respond(message);
  } else if (message.command === 'crash') {
    process.exit(11);
  } else if (message.command === 'terminal') {
    write({ type: 'request', command: 'runInTerminal', arguments: message.arguments });
    respond(message);
  } else if (message.type === 'response') {
    write({ type: 'event', event: 'output', body: { answered: message } });
  } else if (message.type === 'request') {
    respond(message, { echoed: message.command });
  }
}
setInterval(() => undefined, 1000);
`;

describe.skipIf(process.platform === 'win32')('DebugManager', () => {
  let scratch: string = '';
  let root: string = '';
  let pids: string = '';
  let script: string = '';
  let mode: string = 'normal';
  let command: string = process.execPath;
  let gate: Promise<void> = Promise.resolve();
  let manager: InstanceType<typeof DebugManager>;
  let sent: { channel: string; payload: unknown }[] = [];

  /**
   * Reads every adapter process started so far.
   * @returns Returns the process ids.
   */
  function started(): number[] {
    try {
      return readFileSync(pids, 'utf8')
        .split('\n')
        .filter((line: string): boolean => line.length > 0)
        .map(Number);
    } catch {
      return [];
    }
  }

  /**
   * Invokes a handler the renderer would.
   * @param channel The channel.
   * @param args The arguments.
   * @returns Returns the handler's answer.
   */
  function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler: IpcHandler | undefined = handlers.get(channel);
    if (handler === undefined) {
      throw new Error(`Nothing handles ${channel}`);
    }
    return Promise.resolve(handler({}, ...args));
  }

  /**
   * Starts a session.
   * @param sessionId The session.
   * @returns Returns the outcome.
   */
  function start(sessionId: string = 'session'): Promise<DebugStartResult> {
    return invoke(DebugChannel.Start, {
      sessionId,
      adapterId: 'fake',
      rootPath: root,
    }) as Promise<DebugStartResult>;
  }

  /**
   * Waits for a condition.
   * @param condition The condition.
   * @param what What is being waited for.
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
   * Gets what was sent on a channel.
   * @param channel The channel.
   * @returns Returns the payloads.
   */
  function sentOn<T>(channel: string): T[] {
    return sent
      .filter((entry: { channel: string }): boolean => entry.channel === channel)
      .map((entry: { payload: unknown }): T => entry.payload as T);
  }

  beforeEach(() => {
    scratch = mkdtempSync(path.join(tmpdir(), 'studio-debug-manager-'));
    root = scratch;
    pids = path.join(scratch, 'pids');
    script = path.join(scratch, 'adapter.cjs');
    writeFileSync(script, ADAPTER);
    mode = 'normal';
    command = process.execPath;
    gate = Promise.resolve();
    sent = [];
    handlers.clear();
    const workspace: InstanceType<typeof WorkspaceContext> = new WorkspaceContext();
    workspace.addRoot(root);
    const registry: unknown = {
      resolve: async (adapterId: string): Promise<DebugAdapterResolution> => {
        await gate;
        return adapterId === 'unknown'
          ? { spec: null, error: null }
          : adapterId === 'absent'
            ? { spec: null, error: 'not installed' }
            : { spec: { command, args: [script, mode, pids] }, error: null };
      },
      catalogue: (): unknown[] => [{ id: 'fake' }],
    };
    const window: unknown = {
      isDestroyed: (): boolean => false,
      webContents: {
        send: (channel: string, payload: unknown): void => void sent.push({ channel, payload }),
      },
    };
    manager = new DebugManager(
      (): BrowserWindow | null => window as BrowserWindow,
      workspace,
      registry as DebugAdapterRegistry,
    );
    manager.register();
  });

  afterEach(() => {
    vi.useRealTimers();
    manager.disposeAll();
    for (const pid of started()) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
    rmSync(scratch, { recursive: true, force: true });
  });

  describe('start', () => {
    it('runsTheHandshake_andForwardsTheAdaptersEvents', async () => {
      const result: DebugStartResult = await start();

      expect(result).toEqual({
        success: true,
        capabilities: { supportsConfigurationDoneRequest: true },
      });
      await until(
        (): boolean => sentOn<DebugEventMessage>(DebugChannel.Event).length > 0,
        'the initialized event',
      );
      expect(sentOn<DebugEventMessage>(DebugChannel.Event)[0]).toMatchObject({
        sessionId: 'session',
        event: 'initialized',
      });
    });

    it('aSecondStartOfARunningSession_spawnsNothing', async () => {
      await start();

      expect(await start()).toEqual({ success: true });
      expect(started()).toHaveLength(1);
    });

    it('twoStartsInFlightTogether_spawnOneAdapter', async () => {
      await Promise.all([start(), start()]);

      expect(started()).toHaveLength(1);
    });

    it('aStartStillResolvingWhenEverythingIsDisposed_spawnsNothing', async () => {
      let release: () => void = (): void => undefined;
      gate = new Promise<void>((resolve: () => void): void => {
        release = resolve;
      });
      const outcome: Promise<DebugStartResult> = start();
      await Promise.resolve();

      manager.disposeAll();
      release();

      expect((await outcome).success).toBe(false);
      expect(started()).toHaveLength(0);
    });

    it('aStartAfterDisposeAll_works_asARendererReloadedAfterACrashStartsAgain', async () => {
      await start();
      manager.disposeAll();

      expect((await start()).success).toBe(true);
    });

    it('anAdapterThatCannotBeRun_failsTheStartAtOnce_andARetryCanSucceed', async () => {
      command = path.join(scratch, 'no-such-adapter');

      const result: DebugStartResult = await start();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/ENOENT/);

      command = process.execPath;
      expect((await start()).success).toBe(true);
    });

    it('anAdapterThatDiesInTheHandshake_failsTheStart', async () => {
      mode = 'crash-on-initialize';

      const result: DebugStartResult = await start();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/closed/);
    });

    it('anAdapterThatNeverAnswers_failsTheStartAfterTheTimeout_andIsEnded', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      mode = 'hang';

      const outcome: Promise<DebugStartResult> = start();
      await vi.advanceTimersByTimeAsync(30_000);

      expect(await outcome).toMatchObject({ success: false });
      await expect(invoke(DebugChannel.Request, 'session', 'threads')).rejects.toThrow(
        'No such session',
      );
    });

    it('refusesARootThatIsNotOpen', async () => {
      const result: unknown = await invoke(DebugChannel.Start, {
        sessionId: 's',
        adapterId: 'fake',
        rootPath: path.join(scratch, 'elsewhere'),
      });

      expect(result).toEqual({ success: false, error: 'Workspace root is not open' });
      expect(started()).toHaveLength(0);
    });

    it.each<[string, string, string]>([
      ['absent', 'not installed', 'theRegistrysReason'],
      ['unknown', 'Unknown or unavailable adapter: unknown', 'aNamedFallback'],
    ])('anUnavailableAdapter_%s_reports_%s', async (adapterId: string, error: string) => {
      const result: unknown = await invoke(DebugChannel.Start, {
        sessionId: 's',
        adapterId,
        rootPath: root,
      });

      expect(result).toEqual({ success: false, error });
    });

    it.each<[string, unknown]>([
      ['nothing', undefined],
      ['aString', 'x'],
      ['null', null],
      ['noSessionId', { adapterId: 'a', rootPath: '/r' }],
      ['anEmptyAdapterId', { sessionId: 's', adapterId: '', rootPath: '/r' }],
      ['aNonStringRoot', { sessionId: 's', adapterId: 'a', rootPath: 1 }],
    ])('refuses_%s', async (_name: string, request: unknown) => {
      expect(await invoke(DebugChannel.Start, request)).toEqual({
        success: false,
        error: 'Invalid start request',
      });
    });
  });

  describe('requests', () => {
    it('forwardsToTheAdapter_andAnswersWithItsBody', async () => {
      await start();

      expect(await invoke(DebugChannel.Request, 'session', 'threads', {})).toEqual({
        echoed: 'threads',
      });
    });

    it.each<[string, unknown[], string]>([
      ['aNonStringSession', [1, 'threads'], 'Invalid request'],
      ['aNonStringCommand', ['session', 1], 'Invalid request'],
      ['anEmptyCommand', ['session', ''], 'Invalid request'],
      ['anUnknownSession', ['nope', 'threads'], 'No such session'],
    ])('refuses_%s', async (_name: string, args: unknown[], message: string) => {
      await expect(invoke(DebugChannel.Request, ...args)).rejects.toThrow(message);
    });
  });

  describe('stop', () => {
    it('asksTheAdapterToDisconnect_thenEndsIt', async () => {
      await start();
      const [pid]: number[] = started();

      await invoke(DebugChannel.Stop, 'session');

      await until((): boolean => !alive(pid), 'the adapter to exit');
      await expect(invoke(DebugChannel.Request, 'session', 'threads')).rejects.toThrow(
        'No such session',
      );
    });

    it('anAdapterThatIgnoresDisconnect_isEndedAfterTheGrace', async () => {
      mode = 'ignores-disconnect';
      await start();
      const [pid]: number[] = started();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      const stopped: Promise<unknown> = invoke(DebugChannel.Stop, 'session');
      await vi.advanceTimersByTimeAsync(3_000);
      await stopped;
      vi.useRealTimers();

      await until((): boolean => !alive(pid), 'the adapter to be killed');
    });

    it('isQuiet_forASessionThatIsNotThere_orAMalformedId', async () => {
      await expect(invoke(DebugChannel.Stop, 'nope')).resolves.toBeUndefined();
      await expect(invoke(DebugChannel.Stop, 12)).resolves.toBeUndefined();
    });
  });

  describe('an adapter crashing', () => {
    it('tellsTheRenderer_andEndsTheSession', async () => {
      await start();

      await expect(invoke(DebugChannel.Request, 'session', 'crash')).rejects.toThrow('closed');
      await until(
        (): boolean => sentOn<DebugAdapterExit>(DebugChannel.AdapterExit).length > 0,
        'the exit report',
      );

      expect(sentOn<DebugAdapterExit>(DebugChannel.AdapterExit)).toEqual([
        { sessionId: 'session', code: 11, signal: null },
      ]);
      await expect(invoke(DebugChannel.Request, 'session', 'threads')).rejects.toThrow(
        'No such session',
      );
    });

    it('anEndTheManagerAskedFor_isNotReportedAsACrash', async () => {
      await start();
      const [pid]: number[] = started();

      await invoke(DebugChannel.Stop, 'session');
      await until((): boolean => !alive(pid), 'the adapter to exit');

      expect(sentOn<DebugAdapterExit>(DebugChannel.AdapterExit)).toEqual([]);
    });
  });

  describe('runInTerminal', () => {
    const TERMINAL: unknown = { kind: 'external', title: 'App', cwd: '/w', args: ['node', 'a.js'] };

    /**
     * Has the adapter ask the renderer to host a debuggee.
     * @param args The request's arguments.
     * @returns Returns what the renderer was asked.
     */
    async function asked(args: unknown): Promise<DebugRunInTerminalRequest> {
      await invoke(DebugChannel.Request, 'session', 'terminal', args);
      await until(
        (): boolean => sentOn<DebugRunInTerminalRequest>(DebugChannel.RunInTerminal).length > 0,
        'the relay',
      );
      return sentOn<DebugRunInTerminalRequest>(DebugChannel.RunInTerminal)[0];
    }

    /**
     * Gets what the adapter was answered, which the fake adapter reports as an event.
     * @returns Returns the responses it reported.
     */
    function answers(): { success: boolean; body?: unknown }[] {
      return sentOn<DebugEventMessage>(DebugChannel.Event)
        .filter((message: DebugEventMessage): boolean => message.event === 'output')
        .map(
          (message: DebugEventMessage): { success: boolean; body?: unknown } =>
            (message.body as { answered: { success: boolean; body?: unknown } }).answered,
        );
    }

    it('relaysTheRequest_andCarriesTheRenderersAnswerBack', async () => {
      await start();

      const request: DebugRunInTerminalRequest = await asked(TERMINAL);
      expect(request).toMatchObject({
        sessionId: 'session',
        kind: 'external',
        title: 'App',
        cwd: '/w',
        args: ['node', 'a.js'],
      });

      expect(
        await invoke(DebugChannel.RespondRunInTerminal, {
          sessionId: 'session',
          seq: request.seq,
          processId: 321,
        }),
      ).toBe(true);
      await until((): boolean => answers().length > 0, 'the adapter to hear');
      expect(answers()[0]).toMatchObject({ success: true, body: { processId: 321 } });
    });

    it('carriesARenderersFailureBack', async () => {
      await start();
      const request: DebugRunInTerminalRequest = await asked(TERMINAL);

      await invoke(DebugChannel.RespondRunInTerminal, {
        sessionId: 'session',
        seq: request.seq,
        error: 'no terminal',
      });

      await until((): boolean => answers().length > 0, 'the adapter to hear');
      expect(answers()[0]).toMatchObject({ success: false });
    });

    it.each<[string, unknown]>([
      ['noCommand', { args: [] }],
      ['noUsableCommand', { args: [1, null] }],
      ['noArguments', undefined],
    ])('refuses_%s_withoutAskingTheRenderer', async (_name: string, args: unknown) => {
      await start();

      await invoke(DebugChannel.Request, 'session', 'terminal', args);
      await until((): boolean => answers().length > 0, 'the adapter to hear');

      expect(answers()[0]).toMatchObject({ success: false });
      expect(sentOn(DebugChannel.RunInTerminal)).toEqual([]);
    });

    it.each<[string, unknown]>([
      ['nothing', undefined],
      ['aString', 'x'],
      ['noSeq', { sessionId: 'session' }],
      ['aSeqNothingAwaits', { sessionId: 'session', seq: 9999 }],
    ])('anAnswerOf_%s_completesNothing', async (_name: string, payload: unknown) => {
      expect(await invoke(DebugChannel.RespondRunInTerminal, payload)).toBe(false);
    });

    it('aRequestStillOpenWhenTheSessionEnds_isNotLeftForALateAnswer', async () => {
      await start();
      const request: DebugRunInTerminalRequest = await asked(TERMINAL);

      await invoke(DebugChannel.Stop, 'session');

      expect(
        await invoke(DebugChannel.RespondRunInTerminal, {
          sessionId: 'session',
          seq: request.seq,
          processId: 1,
        }),
      ).toBe(false);
    });
  });

  it('disposeAll_endsEverySession', async () => {
    await start('a');
    await start('b');
    const adapters: number[] = started();

    manager.disposeAll();

    await until(
      (): boolean => adapters.every((pid: number): boolean => !alive(pid)),
      'the adapters to exit',
    );
  });

  it('sendsNothing_toAWindowThatHasGone', async () => {
    const quiet: InstanceType<typeof DebugManager> = new DebugManager(
      (): BrowserWindow | null => null,
      new WorkspaceContext(),
      {} as DebugAdapterRegistry,
    );

    expect((): void => quiet.disposeAll()).not.toThrow();
    await expect(invoke(DebugChannel.GetCatalogue)).resolves.toEqual([{ id: 'fake' }]);
  });
});
