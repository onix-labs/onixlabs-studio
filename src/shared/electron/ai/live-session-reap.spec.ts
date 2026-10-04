import { describe, expect, it } from 'vitest';
import { pickReapVictim, ReapCandidate } from './live-session-reap';

/**
 * Builds a session map from [key, lastActivity, turnsInFlight] triples.
 * @param entries The sessions.
 * @returns Returns the map.
 */
function sessions(
  ...entries: readonly (readonly [string, number, number])[]
): ReadonlyMap<string, ReapCandidate> {
  return new Map<string, ReapCandidate>(
    entries.map(([key, lastActivity, turnsInFlight]): [string, ReapCandidate] => [
      key,
      { lastActivity, turnsInFlight },
    ]),
  );
}

describe('pickReapVictim', () => {
  it('picksTheLeastRecentlyUsed_whenEveryoneIsIdle', () => {
    expect(pickReapVictim(sessions(['a', 30, 0], ['b', 10, 0], ['c', 20, 0]), 'c')).toBe('b');
  });

  it('neverPicksTheSessionBeingKept', () => {
    expect(pickReapVictim(sessions(['kept', 1, 0], ['b', 10, 0]), 'kept')).toBe('b');
  });

  it('neverPicksASessionWithATurnInFlight', () => {
    expect(pickReapVictim(sessions(['busy', 1, 1], ['idle', 50, 0], ['new', 99, 0]), 'new')).toBe(
      'idle',
    );
  });

  it('picksNothing_whenEveryOtherSessionIsBusy', () => {
    expect(pickReapVictim(sessions(['a', 1, 1], ['b', 2, 2], ['new', 3, 0]), 'new')).toBeNull();
  });

  it('picksNothing_whenTheOnlySessionIsTheOneKept', () => {
    expect(pickReapVictim(sessions(['new', 3, 0]), 'new')).toBeNull();
  });
});
