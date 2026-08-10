import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { Bridge } from '@shared/api/bridge';
import { LogChannel, LogRecord, StructuredLogInput } from '@shared/api/log-channels';
import { Log } from './log';

describe('Log', () => {
  /**
   * Holds the fire-and-forget messages the stubbed bridge captured, as channel/payload pairs.
   */
  let sent: { channel: string; input: StructuredLogInput }[];

  /**
   * Holds the request/reply calls the stubbed bridge captured.
   */
  let invoked: { channel: string; args: unknown[] }[];

  /**
   * Holds the channel a subscription was opened on and its captured listener.
   */
  let subscribed: { channel: string; listener: (...args: unknown[]) => void } | null;

  /**
   * Installs a recording bridge on the window and resolves the service.
   * @returns Returns the resolved {@link Log} instance.
   */
  function setup(): Log {
    sent = [];
    invoked = [];
    subscribed = null;
    const bridge: Bridge = {
      send: (channel: string, ...args: unknown[]): void => {
        sent.push({ channel, input: args[0] as StructuredLogInput });
      },
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        invoked.push({ channel, args });
        return Promise.resolve([] as unknown as T);
      },
      on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
        subscribed = { channel, listener };
        return (): void => {
          // The unsubscribe is not exercised by these tests.
        };
      },
    };
    (window as { bridge?: unknown }).bridge = bridge;
    return TestBed.inject(Log);
  }

  afterEach(() => {
    delete (window as { bridge?: unknown }).bridge;
  });

  it('info_sendsAnInfoSeverityStructuredLog', () => {
    setup().info('Composer', 'ready');
    expect(sent).toEqual([
      { channel: LogChannel.Append, input: { severity: 'info', source: 'Composer', message: 'ready' } },
    ]);
  });

  it('warn_mapsToWarningSeverity', () => {
    setup().warn('Composer', 'careful');
    expect(sent[0].input.severity).toBe('warning');
  });

  it('trace_and_debug_and_error_useTheirSeverities', () => {
    const log: Log = setup();
    log.trace('A', 'x');
    log.debug('B', 'y');
    log.error('C', 'z');
    expect(sent.map((entry): string => entry.input.severity)).toEqual(['trace', 'debug', 'error']);
  });

  it('emit_appendsSerialisedDetailsAndKeepsErrorStacks', () => {
    setup().info('Src', 'context', { a: 1 }, new Error('boom'));
    expect(sent[0].input.message).toContain('context');
    expect(sent[0].input.message).toContain('{"a":1}');
    expect(sent[0].input.message).toContain('boom');
  });

  it('query_invokesTheQueryChannelWithTheFilter', () => {
    void setup().query({ severities: ['error'] });
    expect(invoked).toEqual([{ channel: LogChannel.Query, args: [{ severities: ['error'] }] }]);
  });

  it('sessions_invokesTheSessionsChannel', () => {
    void setup().sessions();
    expect(invoked[0].channel).toBe(LogChannel.Sessions);
  });

  it('onRecord_subscribesToTheRecordChannelAndUnwrapsThePayload', () => {
    const seen: LogRecord[] = [];
    setup().onRecord((record: LogRecord): void => {
      seen.push(record);
    });
    expect(subscribed?.channel).toBe(LogChannel.Record);
    const record: LogRecord = {
      id: 1,
      sessionId: 's',
      timestamp: 't',
      severity: 'info',
      origin: 'main',
      source: 'x',
      message: 'y',
    };
    subscribed?.listener(record);
    expect(seen).toEqual([record]);
  });

  it('withoutBridge_isASafeNoOp', async () => {
    delete (window as { bridge?: unknown }).bridge;
    const log: Log = TestBed.inject(Log);
    expect((): void => log.info('Src', 'msg')).not.toThrow();
    await expect(log.query()).resolves.toEqual([]);
    expect(
      log.onRecord((): void => {
        // A no-op listener; without a bridge nothing will invoke it.
      }),
    ).toBeTypeOf('function');
  });
});
