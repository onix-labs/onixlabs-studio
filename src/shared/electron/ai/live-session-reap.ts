/**
 * What the memory-pressure valve needs to know about a live session to choose one to reap.
 */
export interface ReapCandidate {
  /**
   * Gets when the session was last active (epoch ms).
   */
  readonly lastActivity: number;

  /**
   * Gets how many turns are running in the session right now.
   */
  readonly turnsInFlight: number;
}

/**
 * Chooses which live session the memory-pressure valve reaps (#328): the least-recently-used one that
 * is neither the session being kept (the one just opened) nor running a turn.
 *
 * ⛔ A session with a turn in flight is never chosen (#788). An agent team runs several sessions at
 * once, and reaping one mid-task would end a worker's run under it; reaping an idle session costs only
 * a cold-start resume on its next turn.
 * @param sessions The live sessions, keyed by agent session id.
 * @param keepKey The key of the session that must stay open.
 * @returns Returns the key to reap, or null when every other session is busy.
 */
export function pickReapVictim(
  sessions: ReadonlyMap<string, ReapCandidate>,
  keepKey: string,
): string | null {
  let oldestKey: string | null = null;
  let oldestActivity: number = Number.POSITIVE_INFINITY;
  for (const [key, entry] of sessions) {
    if (key === keepKey || entry.turnsInFlight > 0) {
      continue;
    }
    if (entry.lastActivity < oldestActivity) {
      oldestKey = key;
      oldestActivity = entry.lastActivity;
    }
  }
  return oldestKey;
}
