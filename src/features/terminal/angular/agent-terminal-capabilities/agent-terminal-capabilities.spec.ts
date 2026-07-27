import { TestBed } from '@angular/core/testing';

import { READ_TERMINAL_OUTPUT, WRITE_TERMINAL_INPUT } from '@shared/api/ai-types';
import { TerminalReplay } from '@shared/api/terminal-channels';
import { AiCapability, AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';
import { Terminals } from '@shared/angular/services/terminals/terminals';
import { AgentTerminalCapabilities } from './agent-terminal-capabilities';

/**
 * The result of the read-terminal-output capability, as the registered handler returns it.
 */
interface ReadResult {
  readonly available: boolean;
  readonly text: string;
}

/**
 * The result of the write-terminal-input capability, as the registered handler returns it.
 */
interface WriteResult {
  readonly ok: boolean;
  readonly output?: string;
}

describe('AgentTerminalCapabilities', () => {
  let registered: Map<string, AiCapability>;
  let terminals: Terminals;
  let writes: { id: string; data: string }[];
  let replays: Map<string, TerminalReplay>;

  beforeEach(() => {
    registered = new Map<string, AiCapability>();
    writes = [];
    replays = new Map<string, TerminalReplay>();
    const runtimeStub: Pick<AiRuntime, 'registerCapability'> = {
      registerCapability: (name: string, handler: AiCapability): (() => void) => {
        registered.set(name, handler);
        return (): void => undefined;
      },
    };
    const bridgeStub: Pick<TerminalBridge, 'write' | 'replay'> = {
      write: (id: string, data: string): Promise<boolean> => {
        writes.push({ id, data });
        return Promise.resolve(true);
      },
      replay: (id: string): Promise<TerminalReplay> =>
        Promise.resolve(replays.get(id) ?? { data: '', seq: 0, exitCode: null, signal: null }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: AiRuntime, useValue: runtimeStub },
        { provide: TerminalBridge, useValue: bridgeStub },
      ],
    });
    terminals = TestBed.inject(Terminals);
    // Instantiate the service so it registers its capabilities.
    TestBed.inject(AgentTerminalCapabilities);
  });

  it('constructor_whenInstantiated_registersReadAndWriteCapabilities', () => {
    expect(registered.has(READ_TERMINAL_OUTPUT)).toBe(true);
    expect(registered.has(WRITE_TERMINAL_INPUT)).toBe(true);
  });

  it('read_whenNoTerminalRegistered_reportsUnavailable', async () => {
    const read: AiCapability | undefined = registered.get(READ_TERMINAL_OUTPUT);

    expect(await read?.({ tabId: 'term-1' })).toEqual({ available: false, text: '' });
  });

  it('read_whenTerminalRegistered_returnsItsOutput', async () => {
    terminals.register('term-1', { readText: (): string => 'line one\nline two' });
    const read: AiCapability | undefined = registered.get(READ_TERMINAL_OUTPUT);

    expect(await read?.({ tabId: 'term-1' })).toEqual({
      available: true,
      text: 'line one\nline two',
    });
  });

  it('read_whenTabIdGiven_readsThatTerminalNotAnother', async () => {
    terminals.register('term-1', { readText: (): string => 'one' });
    terminals.register('term-2', { readText: (): string => 'two' });
    const read: AiCapability | undefined = registered.get(READ_TERMINAL_OUTPUT);

    expect(((await read?.({ tabId: 'term-1' })) as ReadResult).text).toBe('one');
  });

  it('read_whenNoPaneIsMountedHere_fallsBackToTheScrollbackReplay', async () => {
    // The session's pane lives in another window (a popped-out panel): no local read handle, but
    // the main-process scrollback still answers — control sequences stripped.
    const esc: string = String.fromCharCode(27);
    const bel: string = String.fromCharCode(7);
    replays.set('term-9', {
      data: `${esc}]0;title${bel}$ echo hi\r\n${esc}[32mhi${esc}[0m\r\n`,
      seq: 3,
      exitCode: null,
      signal: null,
    });
    const read: AiCapability | undefined = registered.get(READ_TERMINAL_OUTPUT);

    expect(await read?.({ tabId: 'term-9' })).toEqual({ available: true, text: '$ echo hi\nhi\n' });
  });

  it('write_whenSubmitted_writesTextWithCarriageReturnAndReturnsOutput', async () => {
    terminals.register('term-1', { readText: (): string => 'result' });
    const write: AiCapability | undefined = registered.get(WRITE_TERMINAL_INPUT);

    const result: WriteResult = (await write?.({ tabId: 'term-1', text: 'ls' })) as WriteResult;

    expect(writes).toEqual([{ id: 'term-1', data: 'ls\r' }]);
    expect(result).toEqual({ ok: true, output: 'result' });
  });

  it('write_whenSubmitFalse_writesRawTextWithoutCarriageReturn', async () => {
    terminals.register('term-1', { readText: (): string => 'result' });
    const write: AiCapability | undefined = registered.get(WRITE_TERMINAL_INPUT);

    await write?.({ tabId: 'term-1', text: 'ls', submit: false });

    expect(writes).toEqual([{ id: 'term-1', data: 'ls' }]);
  });

  it('write_whenInputMalformed_reportsNotOk', async () => {
    const write: AiCapability | undefined = registered.get(WRITE_TERMINAL_INPUT);

    const result: WriteResult = (await write?.({ tabId: 'term-1' })) as WriteResult;

    expect(result).toEqual({ ok: false });
    expect(writes).toHaveLength(0);
  });
});
