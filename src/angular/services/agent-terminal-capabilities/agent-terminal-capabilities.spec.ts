import { TestBed } from '@angular/core/testing';

import { READ_TERMINAL_OUTPUT, WRITE_TERMINAL_INPUT } from '../../../shared/ai-types';
import { AiCapability, AiRuntime } from '../ai-runtime/ai-runtime';
import { TerminalBridge } from '../terminal-bridge/terminal-bridge';
import { Terminals } from '../terminals/terminals';
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

  beforeEach(() => {
    registered = new Map<string, AiCapability>();
    writes = [];
    const runtimeStub: Pick<AiRuntime, 'registerCapability'> = {
      registerCapability: (name: string, handler: AiCapability): (() => void) => {
        registered.set(name, handler);
        return (): void => undefined;
      },
    };
    const bridgeStub: Pick<TerminalBridge, 'write'> = {
      write: (id: string, data: string): Promise<boolean> => {
        writes.push({ id, data });
        return Promise.resolve(true);
      },
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

  it('read_whenNoTerminalRegistered_reportsUnavailable', () => {
    const read: AiCapability | undefined = registered.get(READ_TERMINAL_OUTPUT);

    expect(read?.({ tabId: 'term-1' })).toEqual({ available: false, text: '' });
  });

  it('read_whenTerminalRegistered_returnsItsOutput', () => {
    terminals.register('term-1', { readText: (): string => 'line one\nline two' });
    const read: AiCapability | undefined = registered.get(READ_TERMINAL_OUTPUT);

    expect(read?.({ tabId: 'term-1' })).toEqual({ available: true, text: 'line one\nline two' });
  });

  it('read_whenTabIdGiven_readsThatTerminalNotAnother', () => {
    terminals.register('term-1', { readText: (): string => 'one' });
    terminals.register('term-2', { readText: (): string => 'two' });
    const read: AiCapability | undefined = registered.get(READ_TERMINAL_OUTPUT);

    expect((read?.({ tabId: 'term-1' }) as ReadResult).text).toBe('one');
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
