import { describe, expect, it } from 'vitest';
import {
  AGENT_PROTOCOL_VERSION,
  HarnessMessage,
  isProtocolCompatible,
  parseHarnessMessage,
} from './agent-protocol';

describe('isProtocolCompatible', () => {
  it('acceptsTheVersionThisBuildImplements', () => {
    expect(isProtocolCompatible(AGENT_PROTOCOL_VERSION)).toBe(true);
  });

  it('refusesADifferentMajor', () => {
    expect(isProtocolCompatible('2.0.0', '1.4.0')).toBe(false);
    expect(isProtocolCompatible('0.9.0', '1.0.0')).toBe(false);
  });

  it('acceptsAnOlderMinorBecauseEveryVersionOnlyAdds', () => {
    expect(isProtocolCompatible('1.1.0', '1.4.0')).toBe(true);
  });

  it('refusesANewerMinor', () => {
    // A harness written against a later version may rely on a message this build would silently
    // ignore, and a turn that quietly does less is worse than one that refuses to start.
    expect(isProtocolCompatible('1.5.0', '1.4.0')).toBe(false);
  });

  it('refusesANewerPatchButAcceptsAnOlderOne', () => {
    expect(isProtocolCompatible('1.4.1', '1.4.0')).toBe(false);
    expect(isProtocolCompatible('1.4.0', '1.4.1')).toBe(true);
  });

  it('refusesAnythingThatIsNotPlainSemver', () => {
    expect(isProtocolCompatible('1.4', '1.4.0')).toBe(false);
    expect(isProtocolCompatible('v1.4.0', '1.4.0')).toBe(false);
    expect(isProtocolCompatible('', '1.4.0')).toBe(false);
  });
});

describe('parseHarnessMessage', () => {
  it('acceptsEachMessageTypeAHarnessMaySend', () => {
    const messages: readonly unknown[] = [
      { type: 'ready', capabilities: {} },
      { type: 'event', event: { requestId: 'r1', kind: 'text', delta: 'hi' } },
      { type: 'request', callId: 'c1', requestId: 'r1', request: { kind: 'permission' } },
      { type: 'audit', name: 'Bash', detail: 'ls', source: 'posture' },
      { type: 'turn.completed', requestId: 'r1', sessionId: 's1' },
      { type: 'turn.failed', requestId: 'r1', error: 'boom' },
    ];

    for (const message of messages) {
      expect(parseHarnessMessage(message)).not.toBeNull();
    }
  });

  it('refusesAMessageTypeItDoesNotKnow', () => {
    // A closed set: a harness cannot invent a message and have Studio pass it along.
    expect(parseHarnessMessage({ type: 'turn.start', turn: {} })).toBeNull();
    expect(parseHarnessMessage({ type: 'exec', command: 'rm -rf /' })).toBeNull();
  });

  it('refusesARequestWithNoCallId', () => {
    // Nothing could route the answer back, and the harness would block forever waiting for it.
    expect(
      parseHarnessMessage({ type: 'request', requestId: 'r1', request: { kind: 'permission' } }),
    ).toBeNull();
  });

  it('refusesTurnTrafficThatNamesNoRun', () => {
    // An event for no run cannot be rendered; a settle for no run would resolve nothing.
    expect(parseHarnessMessage({ type: 'turn.completed', sessionId: 's1' })).toBeNull();
    expect(parseHarnessMessage({ type: 'turn.failed', error: 'boom' })).toBeNull();
    expect(parseHarnessMessage({ type: 'request', callId: 'c1', request: {} })).toBeNull();
  });

  it('refusesAnythingThatIsNotAMessageObject', () => {
    expect(parseHarnessMessage(null)).toBeNull();
    expect(parseHarnessMessage('ready')).toBeNull();
    expect(parseHarnessMessage(42)).toBeNull();
    expect(parseHarnessMessage([{ type: 'ready' }])).toBeNull();
    expect(parseHarnessMessage({})).toBeNull();
  });

  it('narrowsToTheDiscriminatedUnionSoCallersCanSwitch', () => {
    const parsed: HarnessMessage | null = parseHarnessMessage({
      type: 'turn.failed',
      requestId: 'r1',
      error: 'boom',
    });

    expect(parsed?.type).toBe('turn.failed');
    expect(parsed !== null && parsed.type === 'turn.failed' ? parsed.error : null).toBe('boom');
  });
});
