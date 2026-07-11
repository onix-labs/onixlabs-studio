import { TestBed } from '@angular/core/testing';

import { Bridge } from '@shared/api/bridge';
import { LogChannel, LogEntry, MAX_LOG_MESSAGE_LENGTH } from '@shared/api/log-channels';
import { ConsoleForwarder } from './console-forwarder';

describe('ConsoleForwarder', () => {
  /**
   * Holds the messages the stubbed bridge captured, as channel/payload pairs.
   */
  let sent: { channel: string; entry: LogEntry }[];

  /**
   * Holds the service under test, so every test can restore the console it patched.
   */
  let forwarder: ConsoleForwarder | null = null;

  /**
   * Installs a recording bridge on the window and resolves the service, which patches the console.
   * @returns Returns the resolved {@link ConsoleForwarder} instance.
   */
  function setup(): ConsoleForwarder {
    sent = [];
    const bridge: Pick<Bridge, 'send'> = {
      send: (channel: string, ...args: unknown[]): void => {
        sent.push({ channel, entry: args[0] as LogEntry });
      },
    };
    (window as { bridge?: unknown }).bridge = bridge;
    forwarder = TestBed.inject(ConsoleForwarder);
    return forwarder;
  }

  afterEach(() => {
    // The service patches the process-global console and specs share module state (isolate=false),
    // so every test must restore it and drop the window bridge stub.
    forwarder?.restore();
    forwarder = null;
    delete (window as { bridge?: unknown }).bridge;
  });

  it('interceptedConsole_stillCallsTheNativeMethod', () => {
    const calls: unknown[][] = [];
    const native: (...args: unknown[]) => void = console.info;
    console.info = (...args: unknown[]): void => {
      calls.push(args);
    };
    try {
      setup();
      console.info('through to native');
      expect(calls).toEqual([['through to native']]);
    } finally {
      // Unpatch before reinstating the true native, or restore() would resurrect the recorder.
      forwarder?.restore();
      forwarder = null;
      console.info = native;
    }
  });

  it('consoleCall_forwardsTheLevelAndMessageOverTheBridge', () => {
    setup();
    console.warn('disk almost full');
    expect(sent).toEqual([
      { channel: LogChannel.Write, entry: { level: 'warn', message: 'disk almost full' } },
    ]);
  });

  it('serialize_joinsStringsErrorsAndObjects', () => {
    setup();
    console.error('failed:', new Error('boom'), { code: 7 });
    expect(sent).toHaveLength(1);
    expect(sent[0].entry.level).toBe('error');
    expect(sent[0].entry.message).toContain('failed:');
    expect(sent[0].entry.message).toContain('boom');
    expect(sent[0].entry.message).toContain('{"code":7}');
  });

  it('serialize_capsTheMessageLength', () => {
    setup();
    console.log('x'.repeat(MAX_LOG_MESSAGE_LENGTH * 2));
    expect(sent[0].entry.message.length).toBe(MAX_LOG_MESSAGE_LENGTH);
  });

  it('serialize_fallsBackToStringForCircularStructures', () => {
    setup();
    interface Circular {
      self?: Circular;
    }
    const circular: Circular = {};
    circular.self = circular;
    console.log(circular);
    expect(sent[0].entry.message).toBe('[object Object]');
  });

  it('recursingBridge_doesNotLoop', () => {
    sent = [];
    const bridge: Pick<Bridge, 'send'> = {
      send: (channel: string, ...args: unknown[]): void => {
        sent.push({ channel, entry: args[0] as LogEntry });
        // A bridge implementation that itself logs must not re-enter the forwarder.
        console.log('from inside the bridge');
      },
    };
    (window as { bridge?: unknown }).bridge = bridge;
    forwarder = TestBed.inject(ConsoleForwarder);
    console.log('outer');
    expect(sent).toHaveLength(1);
    expect(sent[0].entry.message).toBe('outer');
  });

  it('restore_reinstatesTheNativeConsoleMethods', () => {
    setup();
    forwarder?.restore();
    sent = [];
    console.log('after restore');
    expect(sent).toEqual([]);
  });
});
