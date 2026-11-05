import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { TerminalChannel } from '@shared/api/terminal-channels';
import type {
  ShellInfo,
  TerminalCreateResult,
  TerminalReplay,
} from '@shared/api/terminal-channels';
import type { BrowserWindow } from 'electron';

/**
 * Describes an IPC handler as the fake `ipcMain` captures it.
 */
type Handler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * Describes what a fake pseudo-terminal's exit event carries.
 */
interface ExitEvent {
  exitCode: number;
  signal?: number;
}

/**
 * A pseudo-terminal under the test's control: nothing is spawned, and output and exits arrive when the
 * test says. Pids sit above every platform's pid ceiling, so even a signal that escaped the `process.kill`
 * spy could reach nothing.
 */
class FakePty {
  public static nextPid: number = 5_000_000;
  public readonly pid: number = (FakePty.nextPid += 1);
  public process: string = 'zsh';
  public readonly written: string[] = [];
  public readonly resized: (readonly [number, number])[] = [];
  public writeError: Error | undefined;
  public resizeError: Error | undefined;
  private dataListener: (data: string) => void = (): void => undefined;
  private exitListener: (event: ExitEvent) => void = (): void => undefined;

  public onData(listener: (data: string) => void): void {
    this.dataListener = listener;
  }

  public onExit(listener: (event: ExitEvent) => void): void {
    this.exitListener = listener;
  }

  public write(data: string): void {
    if (this.writeError !== undefined) {
      throw this.writeError;
    }
    this.written.push(data);
  }

  public resize(cols: number, rows: number): void {
    if (this.resizeError !== undefined) {
      throw this.resizeError;
    }
    this.resized.push([cols, rows]);
  }

  public emitData(data: string): void {
    this.dataListener(data);
  }

  public emitExit(event: ExitEvent): void {
    this.exitListener(event);
  }
}

/**
 * Describes a recorded `pty.spawn` call.
 */
interface SpawnCall {
  file: string;
  args: readonly string[];
  options: { cols: number; rows: number; cwd: string; env: Record<string, string> };
}

/**
 * Holds the fake layers: registered handlers, messages sent to the window, spawns, and what the next
 * spawn does.
 */
const fakes: {
  handlers: Map<string, Handler>;
  sent: unknown[][];
  spawns: SpawnCall[];
  ptys: FakePty[];
  spawnError: Error | undefined;
  lsof: { error: Error | null; stdout: string };
  execCalls: string[][];
} = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  sent: [],
  spawns: [],
  ptys: [],
  spawnError: undefined,
  lsof: { error: null, stdout: '' },
  execCalls: [],
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler): void => void fakes.handlers.set(channel, handler),
  },
}));

vi.mock('node-pty', () => {
  const spawn: (file: string, args: readonly string[], options: SpawnCall['options']) => unknown = (
    file: string,
    args: readonly string[],
    options: SpawnCall['options'],
  ): unknown => {
    fakes.spawns.push({ file, args, options });
    if (fakes.spawnError !== undefined) {
      throw fakes.spawnError;
    }
    const created: FakePty = new FakePty();
    fakes.ptys.push(created);
    return created;
  };
  return { spawn, default: { spawn } };
});

vi.mock('node:child_process', () => {
  const execFile: (...args: unknown[]) => void = (...args: unknown[]): void => {
    fakes.execCalls.push(args.filter((arg: unknown): arg is string => typeof arg === 'string'));
    const callback: unknown = args.at(-1);
    if (typeof callback === 'function') {
      Reflect.apply(callback, undefined, [fakes.lsof.error, fakes.lsof.stdout]);
    }
  };
  return { execFile, default: { execFile } };
});

const { TerminalManager } = await import('./terminal-manager');

describe('TerminalManager', () => {
  let manager: InstanceType<typeof TerminalManager>;
  let windowOpen: boolean;
  let windowDestroyed: boolean;
  let kill: MockInstance;

  /**
   * Invokes a captured IPC handler as the renderer would.
   * @param channel The channel.
   * @param args The renderer-supplied arguments.
   * @returns Returns what it answered.
   */
  async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    const handler: Handler | undefined = fakes.handlers.get(channel);
    if (handler === undefined) {
      throw new Error(`Nothing registered ${channel}`);
    }
    return (await handler({ sender: {} }, ...args)) as T;
  }

  /**
   * Creates a session.
   * @param options The options to change.
   * @returns Returns the fake pseudo-terminal behind it.
   */
  async function create(options: Record<string, unknown> = {}): Promise<FakePty> {
    await invoke(TerminalChannel.Create, { id: 't1', ...options });
    const created: FakePty | undefined = fakes.ptys.at(-1);
    if (created === undefined) {
      throw new Error('Nothing was spawned');
    }
    return created;
  }

  /**
   * Lists the output chunks the window received.
   * @param id The session.
   * @returns Returns the chunks.
   */
  function output(id: string = 't1'): readonly unknown[] {
    return fakes.sent
      .filter(
        (message: unknown[]): boolean => message[0] === TerminalChannel.Data && message[1] === id,
      )
      .map((message: unknown[]): unknown => message[2]);
  }

  /**
   * Lists the exits the window was told of.
   * @returns Returns the messages, without their channel.
   */
  function exits(): readonly unknown[][] {
    return fakes.sent
      .filter((message: unknown[]): boolean => message[0] === TerminalChannel.Exit)
      .map((message: unknown[]): unknown[] => message.slice(1));
  }

  /**
   * Lists the signals sent to a process group.
   * @param pty The session.
   * @returns Returns the signal names.
   */
  function signalsTo(pty: FakePty): readonly unknown[] {
    return kill.mock.calls
      .filter((call: unknown[]): boolean => call[0] === -pty.pid)
      .map((call: unknown[]): unknown => call[1]);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    // ⛔ Nothing here may signal a real process: every kill is captured.
    kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    fakes.handlers.clear();
    fakes.sent = [];
    fakes.spawns = [];
    fakes.ptys = [];
    fakes.spawnError = undefined;
    fakes.lsof = { error: null, stdout: '' };
    fakes.execCalls = [];
    windowOpen = true;
    windowDestroyed = false;
    manager = new TerminalManager((): BrowserWindow | null =>
      windowOpen
        ? ({
            isDestroyed: (): boolean => windowDestroyed,
            webContents: {
              send: (...message: unknown[]): void => void fakes.sent.push(message),
            },
          } as unknown as BrowserWindow)
        : null,
    );
    manager.register();
  });

  afterEach(() => {
    manager.disposeAll();
    vi.clearAllTimers();
    vi.useRealTimers();
    kill.mockRestore();
  });

  describe('create', () => {
    it.each([[undefined], [null], ['t1'], [{}], [{ id: '' }], [{ id: 7 }]])(
      'create_withUnusableOptions_spawnsNothing %#',
      async (options: unknown) => {
        expect(await invoke(TerminalChannel.Create, options)).toEqual({
          success: false,
          error: 'Invalid terminal options',
        });

        expect(fakes.spawns).toEqual([]);
      },
    );

    it('create_withTheSameId_reusesTheLiveSession', async () => {
      const pty: FakePty = await create();

      const result: TerminalCreateResult = await invoke(TerminalChannel.Create, { id: 't1' });

      expect(result).toMatchObject({ success: true, pid: pty.pid });
      expect(fakes.spawns).toHaveLength(1);
    });

    it.each([
      [0, 80],
      [-1, 80],
      [Number.NaN, 80],
      [Number.POSITIVE_INFINITY, 80],
      ['120', 80],
      [120, 120],
    ])('create_withCols %s_uses %s', async (cols: unknown, expected: number) => {
      await create({ cols });

      expect(fakes.spawns[0]?.options.cols).toBe(expected);
    });

    it('create_layersTheCallersStringEnvironmentOverTheApplications', async () => {
      await create({ env: { FOO: 'bar', NUMBER: 7, NOTHING: null } });

      const env: Record<string, string> | undefined = fakes.spawns[0]?.options.env;
      expect(env?.['FOO']).toBe('bar');
      expect(env).not.toHaveProperty('NUMBER');
      expect(env).not.toHaveProperty('NOTHING');
      expect(env?.['PATH']).toBe(process.env['PATH']);
    });

    it('create_withAnUnusableShell_fallsBackToTheDefault', async () => {
      await create({ shell: '/no/such/shell' });

      expect(fakes.spawns[0]?.file).not.toBe('/no/such/shell');
    });

    it('create_withAnUnclosedQuoteInTheShellArguments_refusesInWords', async () => {
      const result: TerminalCreateResult = await invoke(TerminalChannel.Create, {
        id: 't1',
        shellArguments: '--init "unclosed',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('unclosed quote');
      expect(fakes.spawns).toEqual([]);
    });

    it('create_ofACommand_echoesItIntoTheSession', async () => {
      await create({ kind: 'run', command: 'npm', args: ['test'] });

      expect(output()[0]).toContain('> npm test');
    });

    it('create_withArgumentsThatAreNotAllStrings_ignoresThem', async () => {
      await create({ kind: 'run', command: 'npm', args: ['test', 7] });

      expect(output()[0]).toContain('> npm\x1b');
    });

    it('create_ofAShellThatWillNotSpawn_reportsTheError', async () => {
      fakes.spawnError = new Error('posix_spawnp failed');

      const result: TerminalCreateResult = await invoke(TerminalChannel.Create, { id: 't1' });

      expect(result).toEqual({ success: false, error: 'posix_spawnp failed' });
      expect(exits()).toEqual([]);
    });

    it('create_ofACommandThatWillNotSpawn_showsItInThePane_andRecordsAnExit', async () => {
      fakes.spawnError = new Error('posix_spawnp failed');

      await invoke(TerminalChannel.Create, { id: 't1', kind: 'run', command: 'nope' });

      expect(output()[0]).toContain('Failed to start: posix_spawnp failed');
      expect(exits()).toEqual([['t1', 1, null]]);
      const replay: TerminalReplay = await invoke(TerminalChannel.Replay, 't1');
      expect(replay.data).toContain('Failed to start');
      expect(replay.exitCode).toBe(1);
    });

    it('create_afterAnExit_startsAFreshScrollback', async () => {
      const first: FakePty = await create();
      first.emitData('old');
      first.emitExit({ exitCode: 0 });

      await create();

      const replay: TerminalReplay = await invoke(TerminalChannel.Replay, 't1');
      expect(replay.data).not.toContain('old');
      expect(replay.exitCode).toBeNull();
    });

    it('create_carriesEarlierOutputIntoTheScrollback', async () => {
      await create({ earlierOutput: 'before the relaunch' });

      expect((await invoke<TerminalReplay>(TerminalChannel.Replay, 't1')).data).toBe(
        'before the relaunch\r\n',
      );
    });
  });

  describe('output', () => {
    it('data_sendsTheFirstChunkAtOnce_andCoalescesTheFlood', async () => {
      const pty: FakePty = await create();

      pty.emitData('a');
      pty.emitData('b');
      pty.emitData('c');

      expect(output()).toEqual(['a']);

      await vi.advanceTimersByTimeAsync(16);

      expect(output()).toEqual(['a', 'bc']);
    });

    it('data_afterAQuietWindow_sendsAtOnceAgain', async () => {
      const pty: FakePty = await create();
      pty.emitData('a');
      await vi.advanceTimersByTimeAsync(16);

      pty.emitData('b');

      expect(output()).toEqual(['a', 'b']);
    });

    it('data_keepsSequenceNumbersRising_acrossTheCoalescing', async () => {
      const pty: FakePty = await create();

      pty.emitData('a');
      pty.emitData('b');
      await vi.advanceTimersByTimeAsync(16);

      const sequences: readonly unknown[] = fakes.sent.map(
        (message: unknown[]): unknown => message[3],
      );
      expect(sequences).toEqual([1, 2]);
    });

    it('data_ofTwoSessions_neverMix', async () => {
      const first: FakePty = await create({ id: 'a' });
      const second: FakePty = await create({ id: 'b' });

      first.emitData('1');
      second.emitData('2');

      expect(output('a')).toEqual(['1']);
      expect(output('b')).toEqual(['2']);
    });

    it('exit_landsBufferedOutputAheadOfTheBanner', async () => {
      const pty: FakePty = await create();
      pty.emitData('a');
      pty.emitData('last words');

      pty.emitExit({ exitCode: 3 });

      expect(fakes.sent.map((message: unknown[]): unknown => message[0])).toEqual([
        TerminalChannel.Data,
        TerminalChannel.Data,
        TerminalChannel.Exit,
      ]);
      expect(output()).toEqual(['a', 'last words']);
    });

    it('replay_afterAnExit_stillHoldsTheOutputAndTheExit', async () => {
      const pty: FakePty = await create();
      pty.emitData('kept');

      pty.emitExit({ exitCode: 3, signal: 15 });

      expect(await invoke(TerminalChannel.Replay, 't1')).toMatchObject({
        data: 'kept',
        exitCode: 3,
        signal: 15,
      });
    });

    it('exit_withSignalZero_isNotReportedAsSignalled', async () => {
      const pty: FakePty = await create();

      pty.emitExit({ exitCode: 0, signal: 0 });

      expect(exits()).toEqual([['t1', 0, null]]);
    });

    it('replay_withAnUnusableId_answersEmpty', async () => {
      expect(await invoke(TerminalChannel.Replay, 7)).toEqual({
        data: '',
        seq: 0,
        exitCode: null,
        signal: null,
      });
    });

    it('output_withTheWindowGone_stillReachesTheScrollback', async () => {
      const pty: FakePty = await create();
      windowOpen = false;

      pty.emitData('unseen');

      expect((await invoke<TerminalReplay>(TerminalChannel.Replay, 't1')).data).toBe('unseen');
    });

    it('output_toADestroyedWindow_isNotSent', async () => {
      const pty: FakePty = await create();
      windowDestroyed = true;

      pty.emitData('unseen');

      expect(fakes.sent).toEqual([]);
    });

    it('output_arrivingAfterTheProcessExited_isKeptInTheScrollback', async () => {
      const pty: FakePty = await create();
      pty.emitExit({ exitCode: 0 });

      pty.emitData('late');

      expect((await invoke<TerminalReplay>(TerminalChannel.Replay, 't1')).data).toBe('late');
    });

    it('exit_ofADisposedSession_neverReachesItsReplacement', async () => {
      const old: FakePty = await create();
      await invoke(TerminalChannel.Dispose, 't1');
      const successor: FakePty = await create();

      old.emitExit({ exitCode: 9 });

      expect(exits()).toEqual([]);
      expect(await invoke(TerminalChannel.Write, 't1', 'x')).toBe(true);
      expect(successor.written).toEqual(['x']);
    });
  });

  describe('write', () => {
    it('write_reachesTheSession', async () => {
      const pty: FakePty = await create();

      expect(await invoke(TerminalChannel.Write, 't1', 'ls\r')).toBe(true);

      expect(pty.written).toEqual(['ls\r']);
    });

    it.each([
      ['unknown', 'x'],
      [7, 'x'],
      ['t1', 7],
      [undefined, undefined],
    ])('write_withBadArguments_writesNothing %#', async (id: unknown, data: unknown) => {
      const pty: FakePty = await create();

      expect(await invoke(TerminalChannel.Write, id, data)).toBe(false);

      expect(pty.written).toEqual([]);
    });

    it('write_toAnExitedSession_writesNothing', async () => {
      const pty: FakePty = await create();
      pty.emitExit({ exitCode: 0 });

      expect(await invoke(TerminalChannel.Write, 't1', 'x')).toBe(false);

      expect(pty.written).toEqual([]);
    });

    it('write_toATaskSession_passesOnlyCtrlC', async () => {
      const pty: FakePty = await create({ kind: 'task', command: 'npm' });

      expect(await invoke(TerminalChannel.Write, 't1', 'rm -rf /\r')).toBe(false);
      expect(await invoke(TerminalChannel.Write, 't1', '\x03')).toBe(true);

      expect(pty.written).toEqual(['\x03']);
    });

    it('write_toASessionWithAnUnknownKind_treatsItAsAShell', async () => {
      const pty: FakePty = await create({ kind: 'nonsense' });

      expect(await invoke(TerminalChannel.Write, 't1', 'x')).toBe(true);

      expect(pty.written).toEqual(['x']);
    });
  });

  describe('resize', () => {
    it('resize_reachesTheSession', async () => {
      const pty: FakePty = await create();

      expect(await invoke(TerminalChannel.Resize, 't1', 100, 40)).toBe(true);

      expect(pty.resized).toEqual([[100, 40]]);
    });

    it.each([
      ['t1', 0, 40],
      ['t1', 100, -1],
      ['t1', Number.NaN, 40],
      ['t1', '100', 40],
      ['unknown', 100, 40],
      [7, 100, 40],
    ])(
      'resize_withBadArguments_doesNothing %#',
      async (id: unknown, cols: unknown, rows: unknown) => {
        const pty: FakePty = await create();

        expect(await invoke(TerminalChannel.Resize, id, cols, rows)).toBe(false);

        expect(pty.resized).toEqual([]);
      },
    );

    it('resize_thatThrows_answersFalse', async () => {
      const pty: FakePty = await create();
      pty.resizeError = new Error('ioctl failed');

      expect(await invoke(TerminalChannel.Resize, 't1', 100, 40)).toBe(false);
    });
  });

  describe('terminate', () => {
    it('terminate_sendsTermToTheGroup_thenKillsAfterTheGrace', async () => {
      const pty: FakePty = await create();

      expect(await invoke(TerminalChannel.Terminate, 't1', 1000)).toBe(true);
      expect(signalsTo(pty)).toEqual(['SIGTERM']);

      await vi.advanceTimersByTimeAsync(1000);

      expect(signalsTo(pty)).toEqual(['SIGTERM', 'SIGKILL']);
    });

    it.each([[undefined], [0], [-1], [Number.NaN], ['1000']])(
      'terminate_withAnUnusableGrace_waitsTheDefault %#',
      async (grace: unknown) => {
        const pty: FakePty = await create();

        await invoke(TerminalChannel.Terminate, 't1', grace);
        await vi.advanceTimersByTimeAsync(4999);
        expect(signalsTo(pty)).toEqual(['SIGTERM']);

        await vi.advanceTimersByTimeAsync(1);
        expect(signalsTo(pty)).toEqual(['SIGTERM', 'SIGKILL']);
      },
    );

    it('terminate_thatExitsInTime_neverEscalates', async () => {
      const pty: FakePty = await create();
      await invoke(TerminalChannel.Terminate, 't1', 1000);

      pty.emitExit({ exitCode: 0, signal: 15 });
      await vi.advanceTimersByTimeAsync(10_000);

      expect(signalsTo(pty)).toEqual(['SIGTERM']);
      expect(exits()).toEqual([['t1', 0, 15]]);
    });

    it('terminate_keepsTheSessionsScrollback', async () => {
      const pty: FakePty = await create();
      pty.emitData('kept');

      await invoke(TerminalChannel.Terminate, 't1');
      pty.emitExit({ exitCode: 0, signal: 15 });

      expect((await invoke<TerminalReplay>(TerminalChannel.Replay, 't1')).data).toBe('kept');
    });

    it('terminate_twice_armsOneEscalation', async () => {
      const pty: FakePty = await create();

      await invoke(TerminalChannel.Terminate, 't1', 1000);
      await invoke(TerminalChannel.Terminate, 't1', 1000);
      await vi.advanceTimersByTimeAsync(5000);

      expect(
        signalsTo(pty).filter((signal: unknown): boolean => signal === 'SIGKILL'),
      ).toHaveLength(1);
    });

    it('terminate_ofAProcessGroupThatIsGone_fallsBackToThePid', async () => {
      const pty: FakePty = await create();
      kill.mockImplementationOnce((): never => {
        throw new Error('ESRCH');
      });

      await invoke(TerminalChannel.Terminate, 't1');

      expect(kill).toHaveBeenCalledWith(pty.pid, 'SIGTERM');
    });

    it('terminate_ofAProcessEntirelyGone_doesNotThrow', async () => {
      await create();
      kill.mockImplementation((): never => {
        throw new Error('ESRCH');
      });

      await expect(invoke(TerminalChannel.Terminate, 't1')).resolves.toBe(true);
    });

    it('terminate_ofNothing_answersFalse', async () => {
      expect(await invoke(TerminalChannel.Terminate, 'unknown')).toBe(false);
      expect(await invoke(TerminalChannel.Terminate, 7)).toBe(false);
    });

    it('terminate_escalationNeverHitsAReplacementSession', async () => {
      const old: FakePty = await create();
      await invoke(TerminalChannel.Terminate, 't1', 1000);
      await invoke(TerminalChannel.Dispose, 't1');
      const successor: FakePty = await create();

      await vi.advanceTimersByTimeAsync(1000);

      expect(signalsTo(successor)).toEqual([]);
      expect(signalsTo(old).filter((signal: unknown): boolean => signal === 'SIGKILL')).toEqual([]);
    });
  });

  describe('dispose', () => {
    it('dispose_endsTheWholeTree_andForgetsTheSession', async () => {
      const pty: FakePty = await create();

      expect(await invoke(TerminalChannel.Dispose, 't1')).toBe(true);
      await vi.advanceTimersByTimeAsync(5000);

      expect(signalsTo(pty)).toEqual(['SIGTERM', 'SIGKILL']);
      expect(await invoke(TerminalChannel.Write, 't1', 'x')).toBe(false);
    });

    it('dispose_ofAnExitedSession_clearsItsScrollback_withoutSignalling', async () => {
      const pty: FakePty = await create();
      pty.emitData('kept');
      pty.emitExit({ exitCode: 0 });

      expect(await invoke(TerminalChannel.Dispose, 't1')).toBe(true);

      expect(signalsTo(pty)).toEqual([]);
      expect((await invoke<TerminalReplay>(TerminalChannel.Replay, 't1')).data).toBe('');
    });

    it('dispose_ofNothing_answersFalse', async () => {
      expect(await invoke(TerminalChannel.Dispose, 'unknown')).toBe(false);
      expect(await invoke(TerminalChannel.Dispose, 7)).toBe(false);
    });

    it('dispose_withOutputCoalescing_dropsIt', async () => {
      const pty: FakePty = await create();
      pty.emitData('a');
      pty.emitData('dropped');

      await invoke(TerminalChannel.Dispose, 't1');
      await vi.advanceTimersByTimeAsync(100);

      expect(output()).toEqual(['a']);
    });

    it('disposeAll_endsEveryTree_andIsSafeTwice', async () => {
      const first: FakePty = await create({ id: 'a' });
      const second: FakePty = await create({ id: 'b' });
      second.emitData('a');
      second.emitData('pending');

      manager.disposeAll();
      manager.disposeAll();
      await vi.advanceTimersByTimeAsync(5000);

      expect(signalsTo(first)).toEqual(['SIGTERM', 'SIGKILL']);
      expect(signalsTo(second)).toEqual(['SIGTERM', 'SIGKILL']);
      expect(output('b')).toEqual(['a']);
    });
  });

  describe('working directory and foreground', () => {
    it('getCwd_ofNothing_answersNull', async () => {
      expect(await invoke(TerminalChannel.GetCwd, 'unknown')).toBeNull();
      expect(await invoke(TerminalChannel.GetCwd, 7)).toBeNull();
    });

    it.runIf(process.platform === 'darwin')('getCwd_readsTheNameLineLsofPrints', async () => {
      await create();
      fakes.lsof = { error: null, stdout: 'p123\nfcwd\nn/Users/somebody/project\n' };

      expect(await invoke(TerminalChannel.GetCwd, 't1')).toBe('/Users/somebody/project');
    });

    it.runIf(process.platform === 'darwin')('getCwd_whenLsofFails_answersNull', async () => {
      await create();
      fakes.lsof = { error: new Error('timed out'), stdout: '' };

      expect(await invoke(TerminalChannel.GetCwd, 't1')).toBeNull();
    });

    it.runIf(process.platform === 'darwin')('getCwd_withNoNameLine_answersNull', async () => {
      await create();
      fakes.lsof = { error: null, stdout: 'p123\n' };

      expect(await invoke(TerminalChannel.GetCwd, 't1')).toBeNull();
    });

    it('foreground_ofAShellAtItsPrompt_isNothing', async () => {
      const pty: FakePty = await create({ shell: 'zsh' });
      pty.process = 'zsh';

      expect(await invoke(TerminalChannel.GetForeground, 't1')).toBeNull();
    });

    it('foreground_ofAProgramInAShell_namesIt', async () => {
      const pty: FakePty = await create({ shell: 'zsh' });
      pty.process = '/usr/local/bin/vim';

      expect(await invoke(TerminalChannel.GetForeground, 't1')).toBe('vim');
    });

    it('foreground_ofARunSession_isItsCommandEvenWithoutAName', async () => {
      const pty: FakePty = await create({ kind: 'run', command: 'npm' });

      pty.process = 'node';
      expect(await invoke(TerminalChannel.GetForeground, 't1')).toBe('node');

      pty.process = '';
      expect(await invoke(TerminalChannel.GetForeground, 't1')).toBe('a program');
    });

    it('foreground_ofNothing_answersNull', async () => {
      expect(await invoke(TerminalChannel.GetForeground, 'unknown')).toBeNull();
      expect(await invoke(TerminalChannel.GetForeground, 7)).toBeNull();
    });
  });

  describe('shells', () => {
    it('listShells_leadsWithTheDefault_withNoDuplicates_andOnlyExecutables', async () => {
      const shells: readonly ShellInfo[] = await invoke(TerminalChannel.ListShells);
      const paths: readonly string[] = shells.map((shell: ShellInfo): string => shell.path);

      expect(new Set<string>(paths).size).toBe(paths.length);
      expect(paths.length).toBeGreaterThan(0);
      expect(shells[0]?.name.length).toBeGreaterThan(0);
    });
  });
});
