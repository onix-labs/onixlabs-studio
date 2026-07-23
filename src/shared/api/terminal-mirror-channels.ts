import { TerminalKind } from './terminal-channels';

/**
 * Names the terminal-mirror IPC channels: the relay that lets a pop-out window render the workspace
 * window's terminal session strip. The workspace window OWNS the sessions (its `TerminalSessions`
 * store launches, disposes, and tracks them — build/run flows inject it); the pop-out window is a
 * VIEWER — it renders the mirrored metadata, hosts persistent panes attached by session id, and
 * round-trips every strip action back to the owner. The main process relays between the two, since
 * windows cannot address each other directly.
 */
export enum TerminalMirrorChannel {
  /**
   * Announces that a pop-out window's mirror is listening (popout→main, send). The main process
   * relays it to the main window with the pop-out's window identifier, prompting the owner to
   * publish its current state.
   */
  Ready = 'terminal-mirror:ready',

  /**
   * Publishes the owner's session state to a pop-out window (owner→main, send: popout window
   * identifier, state). The main process forwards the state to that pop-out.
   */
  Publish = 'terminal-mirror:publish',

  /**
   * Carries the owner's session state into the pop-out window (main→popout, send: state).
   */
  State = 'terminal-mirror:state',

  /**
   * Carries a strip action from the pop-out back to the owner (popout→main, send: action; relayed
   * to the main window as popout window identifier + action).
   */
  Action = 'terminal-mirror:action',
}

/**
 * One mirrored terminal session: the metadata a pop-out strip needs to render a tab and attach a
 * pane. The pane self-restores from the session identifier (replay + live attach); the generation
 * re-keys it when a relaunch replaces the PTY under the same identifier.
 */
export interface MirrorSession {
  /**
   * Gets the globally-unique identifier of the session's PTY.
   */
  readonly id: string;

  /**
   * Gets the session's display name.
   */
  readonly name: string;

  /**
   * Gets the session kind, deciding the pane's input rules.
   */
  readonly kind: TerminalKind;

  /**
   * Counts the launches under this session's tab; a bump re-keys the pane.
   */
  readonly generation: number;

  /**
   * Gets the exit code the session's process ended with, or null while it runs.
   */
  readonly exitCode: number | null;

  /**
   * Gets the folder the session was rooted at, when known.
   */
  readonly cwd?: string;

  /**
   * Gets the shell executable the session spawned, when known (for the status strip).
   */
  readonly shell?: string;
}

/**
 * The owner's mirrored state: the whole strip in tab order, the active session, and the root the
 * sessions belong to.
 */
export interface MirrorState {
  /**
   * Gets the sessions in tab order.
   */
  readonly sessions: readonly MirrorSession[];

  /**
   * Gets the active session's identifier, or null when there are none.
   */
  readonly activeId: string | null;

  /**
   * Gets the folder the sessions are rooted at, or null when none is open.
   */
  readonly root: string | null;
}

/**
 * Names the strip actions a pop-out mirror can request of the owner.
 */
export type MirrorActionKind = 'activate' | 'close' | 'rename' | 'new-shell' | 'dock-back';

/**
 * A strip action requested by the pop-out mirror, applied by the owner's session store.
 */
export interface MirrorAction {
  /**
   * Gets the action kind.
   */
  readonly kind: MirrorActionKind;

  /**
   * Gets the target session identifier, for session-scoped actions.
   */
  readonly id?: string;

  /**
   * Gets the new display name, for a rename.
   */
  readonly name?: string;
}

/**
 * Holds the recognised mirror action kinds, for defensive parsing.
 */
const ACTION_KINDS: ReadonlySet<string> = new Set<string>([
  'activate',
  'close',
  'rename',
  'new-shell',
  'dock-back',
]);

/**
 * Parses a mirror action defensively, so a malformed payload can never reach the owner's session
 * store as an action it does not understand.
 * @param value The raw action payload.
 * @returns Returns the action, or null when the payload is not a usable action.
 */
export function parseMirrorAction(value: unknown): MirrorAction | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate: { kind?: unknown; id?: unknown; name?: unknown } = value;
  if (typeof candidate.kind !== 'string' || !ACTION_KINDS.has(candidate.kind)) {
    return null;
  }
  if (candidate.id !== undefined && typeof candidate.id !== 'string') {
    return null;
  }
  if (candidate.name !== undefined && typeof candidate.name !== 'string') {
    return null;
  }
  return {
    kind: candidate.kind as MirrorActionKind,
    ...(candidate.id !== undefined ? { id: candidate.id } : {}),
    ...(candidate.name !== undefined ? { name: candidate.name } : {}),
  };
}
