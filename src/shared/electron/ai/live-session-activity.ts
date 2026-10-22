import type { AiEvent } from '@shared/api/ai-types';

/**
 * The part of a held-open live session idle-reap reads: what is still going on in it.
 */
export interface LiveSessionLoad {
  /**
   * Gets how many Studio turns are running in the session now.
   */
  readonly activeTurns: number;

  /**
   * Gets the background tasks the session has started and not yet seen settle.
   */
  readonly liveTasks: ReadonlySet<string>;

  /**
   * Gets whether a prompt the session raised — a permission, a question, an edit decision — is still
   * waiting on the user.
   */
  readonly promptOpen: boolean;
}

/**
 * Keeps a session's set of running background tasks current from one of its events: a started task
 * joins it; a settle, or the terminal patch a foreground task ends on (it never sends a settle), leaves.
 * Any other event leaves the set as it is.
 * @param liveTasks The session's running tasks, updated in place.
 * @param event The event the session emitted.
 */
export function trackTaskEvent(liveTasks: Set<string>, event: AiEvent): void {
  if (event.kind === 'task-started') {
    liveTasks.add(event.taskId);
  } else if (event.kind === 'background-task') {
    liveTasks.delete(event.taskId);
  } else if (
    event.kind === 'task-updated' &&
    (event.status === 'completed' || event.status === 'failed' || event.status === 'killed')
  ) {
    liveTasks.delete(event.taskId);
  }
}

/**
 * Says why a live session is not idle, or null when it genuinely is.
 *
 * 🔥 Quiet is not idle. Idle-reap used to end a session on a timer since its last Studio turn, with no
 * regard for what it was doing: a background task (a CI watch, a long build) was killed with it, and
 * so was a prompt waiting on the user — the agent's promised report-back never came. The log showed 32
 * tasks lost this way in twelve days.
 * @param load What is going on in the session.
 * @returns Returns the reason the session is busy, or null.
 */
export function liveSessionBusyReason(load: LiveSessionLoad): string | null {
  if (load.activeTurns > 0) {
    return 'a turn is running';
  }
  if (load.liveTasks.size > 0) {
    return `${load.liveTasks.size} background task(s) running`;
  }
  if (load.promptOpen) {
    return 'waiting on the user';
  }
  return null;
}
