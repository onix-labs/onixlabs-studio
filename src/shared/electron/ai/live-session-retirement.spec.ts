import { describe, expect, it } from 'vitest';
import { RetirableSession, retirementFor } from './live-session-retirement';

describe('retirementFor (#881)', () => {
  const connections: ReadonlyMap<string, { harnessId?: string | null }> = new Map([
    ['claude-connection', { harnessId: 'onixlabs.claude-harness' }],
    ['codex-connection', { harnessId: 'onixlabs.codex-harness' }],
  ]);

  it('endsAnIdleSessionOnTheChangedHarness_atOnce', () => {
    const sessions: ReadonlyMap<string, RetirableSession> = new Map([
      ['conversation-1', { providerId: 'claude-connection', activeTurns: 0 }],
    ]);

    expect(retirementFor(sessions, connections, 'onixlabs.claude-harness')).toEqual({
      endNow: ['conversation-1'],
      afterTurn: [],
    });
  });

  it('letsASessionMidTurnFinishItsTurn_ratherThanEndingIt', () => {
    // Matthew's rule: never cut off a turn the user is watching for a version change.
    const sessions: ReadonlyMap<string, RetirableSession> = new Map([
      ['conversation-1', { providerId: 'claude-connection', activeTurns: 1 }],
    ]);

    expect(retirementFor(sessions, connections, 'onixlabs.claude-harness')).toEqual({
      endNow: [],
      afterTurn: ['conversation-1'],
    });
  });

  it('leavesSessionsOnOtherHarnesses_andOnUnknownConnections_alone', () => {
    const sessions: ReadonlyMap<string, RetirableSession> = new Map([
      ['codex', { providerId: 'codex-connection', activeTurns: 0 }],
      ['gone', { providerId: 'deleted-connection', activeTurns: 0 }],
    ]);

    expect(retirementFor(sessions, connections, 'onixlabs.claude-harness')).toEqual({
      endNow: [],
      afterTurn: [],
    });
  });
});
