import { TerminalFlowControlTarget } from './terminal-flow-control-target';

/**
 * Specifies the unacknowledged output, in characters, at which a session is paused. Well above a
 * screenful, so ordinary output never touches it, and low enough that `yes` cannot queue hundreds of
 * megabytes of IPC ahead of a renderer that is still parsing.
 */
export const HIGH_WATERMARK: number = 1024 * 1024;

/**
 * Specifies the unacknowledged output, in characters, at which a paused session resumes. The gap to
 * {@link HIGH_WATERMARK} is what stops a flood turning into a pause and a resume per chunk.
 */
export const LOW_WATERMARK: number = 128 * 1024;

/**
 * Specifies how long, in milliseconds, a paused session waits for the next acknowledgement before it
 * resumes regardless. Output must never be able to stop a process for good: a pane can close, a window
 * can reload, and neither says so.
 */
export const ACKNOWLEDGEMENT_TIMEOUT_MS: number = 2_000;

/**
 * Holds what is known about one session's output.
 */
interface FlowState {
  /**
   * Holds what to pause and resume.
   */
  readonly target: TerminalFlowControlTarget;

  /**
   * Holds the characters sent and not yet acknowledged.
   */
  unacknowledged: number;

  /**
   * Holds whether a pane has acknowledged output since the session started or last timed out.
   */
  attached: boolean;

  /**
   * Holds whether the session is paused.
   */
  paused: boolean;

  /**
   * Holds the timer that resumes a paused session nobody is acknowledging.
   */
  watchdog: NodeJS.Timeout | null;
}

/**
 * Applies backpressure to terminal sessions, from the output the renderer says it has parsed.
 *
 * Without it a session writes as fast as it likes, and everything the renderer has not reached yet
 * queues in IPC and in xterm's write buffer. A session is only ever paused while a pane is proven to
 * be reading it: sessions routinely run with no pane attached, recording to the scrollback, and their
 * output is never acknowledged at all. Such a session is left to run exactly as it always has.
 */
export class TerminalFlowControl {
  /**
   * Holds the state of each session, by id.
   */
  private readonly sessions: Map<string, FlowState> = new Map<string, FlowState>();

  /**
   * Starts tracking a session.
   * @param id The session.
   * @param target What to pause and resume.
   */
  public track(id: string, target: TerminalFlowControlTarget): void {
    this.forget(id);
    this.sessions.set(id, {
      target,
      unacknowledged: 0,
      attached: false,
      paused: false,
      watchdog: null,
    });
  }

  /**
   * Records output sent to the renderer, pausing the session when too much of it is unread.
   * @param id The session.
   * @param length The characters sent.
   */
  public sent(id: string, length: number): void {
    const state: FlowState | undefined = this.sessions.get(id);
    if (state?.attached !== true) {
      return;
    }
    state.unacknowledged += length;
    if (!state.paused && state.unacknowledged > HIGH_WATERMARK) {
      state.paused = true;
      state.target.pause();
      this.armWatchdog(id, state);
    }
  }

  /**
   * Records output the renderer has parsed, resuming a paused session once enough of it has been.
   * @param id The session.
   * @param length The characters parsed.
   */
  public acknowledge(id: string, length: number): void {
    const state: FlowState | undefined = this.sessions.get(id);
    if (state === undefined) {
      return;
    }
    // Counting only starts here, so nothing sent before a pane attached is ever waited for.
    state.attached = true;
    state.unacknowledged = Math.max(0, state.unacknowledged - length);
    if (!state.paused) {
      return;
    }
    if (state.unacknowledged <= LOW_WATERMARK) {
      this.resume(state);
    } else {
      this.armWatchdog(id, state);
    }
  }

  /**
   * Stops tracking a session.
   * @param id The session.
   */
  public forget(id: string): void {
    const state: FlowState | undefined = this.sessions.get(id);
    if (state?.watchdog != null) {
      clearTimeout(state.watchdog);
    }
    this.sessions.delete(id);
  }

  /**
   * Starts the wait for the next acknowledgement, replacing any wait in progress.
   * @param id The session.
   * @param state The session's state.
   */
  private armWatchdog(id: string, state: FlowState): void {
    if (state.watchdog !== null) {
      clearTimeout(state.watchdog);
    }
    state.watchdog = setTimeout((): void => {
      if (this.sessions.get(id) === state) {
        state.attached = false;
        state.unacknowledged = 0;
        this.resume(state);
      }
    }, ACKNOWLEDGEMENT_TIMEOUT_MS);
    // Never what keeps the app alive at quit.
    state.watchdog.unref?.();
  }

  /**
   * Resumes a paused session.
   * @param state The session's state.
   */
  private resume(state: FlowState): void {
    if (state.watchdog !== null) {
      clearTimeout(state.watchdog);
      state.watchdog = null;
    }
    state.paused = false;
    state.target.resume();
  }
}
