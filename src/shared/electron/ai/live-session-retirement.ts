import type { AiConnection } from '@shared/api/ai-types';

/**
 * The part of a held-open live session retirement reads: which connection it runs through, and how
 * many turns are running in it now.
 */
export interface RetirableSession {
  /**
   * Gets the connection id the session runs through.
   */
  readonly providerId: string;

  /**
   * Gets how many turns are running in the session now.
   */
  readonly activeTurns: number;
}

/**
 * Says which live sessions a harness change ends, and when.
 */
export interface Retirement {
  /**
   * Gets the sessions with no turn running, which end at once.
   */
  readonly endNow: readonly string[];

  /**
   * Gets the sessions with a turn running, which finish it and then end.
   */
  readonly afterTurn: readonly string[];
}

/**
 * Decides which live sessions end because the harness they run on was updated or removed (#881).
 *
 * ⛔ A session in the middle of a turn is never ended by this. It is let finish — the process it runs
 * in has everything it needs, even once its files are gone — and ends as the turn settles. Ending it
 * at once would throw away a turn the user is watching, for the sake of a version change that the
 * very next turn picks up anyway.
 * @param sessions The live sessions, by key.
 * @param connections The connections, by id, which name the harness each runs through.
 * @param harnessId The harness that changed.
 * @returns Returns the sessions to end now and the ones to end after their turn.
 */
export function retirementFor(
  sessions: ReadonlyMap<string, RetirableSession>,
  connections: ReadonlyMap<string, Pick<AiConnection, 'harnessId'>>,
  harnessId: string,
): Retirement {
  const endNow: string[] = [];
  const afterTurn: string[] = [];
  for (const [key, session] of sessions) {
    if (connections.get(session.providerId)?.harnessId !== harnessId) {
      continue;
    }
    (session.activeTurns === 0 ? endNow : afterTurn).push(key);
  }
  return { endNow, afterTurn };
}
