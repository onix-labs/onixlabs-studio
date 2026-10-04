// The agent-team tools' shared contract (#788): their names, inputs and answers, the worker states and
// the board, and the validation both processes apply to a request that crosses the bridge. Platform-
// neutral (types, constants and pure functions only), so the Electron back-end and the Angular
// front-end can both import it.

/**
 * Says what part a run's agent plays in a team, which decides the team tools it is offered: a `lead`
 * starts and directs workers; a `worker` reads and posts to the board and reports its task done or
 * failed. Absent for an agent in no team, which is offered none of them.
 */
export type AgentTeamRole = 'lead' | 'worker';

/**
 * The team roles, for validating an untrusted request.
 */
export const AGENT_TEAM_ROLES: readonly AgentTeamRole[] = ['lead', 'worker'];

/**
 * The lead's tool that starts a worker on a task, in a checkout of its own on a branch of its own.
 */
export const TEAM_START_WORKER: string = 'start_worker';

/**
 * The lead's tool that reports its workers' state.
 */
export const TEAM_WORKER_STATUS: string = 'worker_status';

/**
 * The lead's tool that gives a worker further instructions between its turns.
 */
export const TEAM_INSTRUCT_WORKER: string = 'instruct_worker';

/**
 * The lead's tool that stops a worker.
 */
export const TEAM_STOP_WORKER: string = 'stop_worker';

/**
 * The tool, for lead and workers alike, that reads the team's board.
 */
export const TEAM_READ_BOARD: string = 'read_board';

/**
 * The tool, for lead and workers alike, that posts to the team's board.
 */
export const TEAM_POST_TO_BOARD: string = 'post_to_board';

/**
 * The worker's tool that reports its task done, which wakes the lead.
 */
export const TEAM_COMPLETE_TASK: string = 'complete_task';

/**
 * The worker's tool that reports it cannot finish its task, which wakes the lead.
 */
export const TEAM_FAIL_TASK: string = 'fail_task';

/**
 * Where a worker is in its task. Named after the MCP Tasks extension's and A2A's task states, so that
 * adopting either later is a mapping rather than a redesign:
 *
 * - `starting`: its checkout and session are being prepared.
 * - `working`: running a turn.
 * - `input_required`: waiting on the user — a permission, a question or an edit decision.
 * - `idle`: between turns, its task not yet reported; the lead may instruct it further.
 * - `completed` / `failed`: it reported its task done, or that it cannot finish it.
 * - `cancelled`: stopped by the lead or the user.
 */
export type TeamWorkerState =
  'starting' | 'working' | 'input_required' | 'idle' | 'completed' | 'failed' | 'cancelled';

/**
 * The states a worker does not leave.
 */
export const TERMINAL_WORKER_STATES: readonly TeamWorkerState[] = [
  'completed',
  'failed',
  'cancelled',
];

/**
 * What a board entry says about its author's work:
 *
 * - `claim`: what it is changing, so others keep clear.
 * - `change`: something others depend on — a renamed type, a moved file.
 * - `blocked`: what it is waiting for.
 * - `note`: anything else worth the team knowing.
 */
export type TeamBoardKind = 'claim' | 'change' | 'blocked' | 'note';

/**
 * The board entry kinds, for validating an untrusted request.
 */
export const TEAM_BOARD_KINDS: readonly TeamBoardKind[] = ['claim', 'change', 'blocked', 'note'];

/**
 * One entry on a team's board.
 */
export interface TeamBoardEntry {
  /**
   * Gets the entry's position on the board, counting from 1; `read_board` takes the last one seen.
   */
  readonly sequence: number;

  /**
   * Gets who posted it: the lead, or a worker's title.
   */
  readonly author: string;

  /**
   * Gets when it was posted (epoch ms).
   */
  readonly at: number;

  /**
   * Gets what it says about the author's work.
   */
  readonly kind: TeamBoardKind;

  /**
   * Gets what it says.
   */
  readonly text: string;
}

/**
 * The answer to every team tool: whether it did what was asked, and what to tell the model either way.
 * A refusal is an answer, not an error — the reason is information the model can act on.
 */
export interface TeamToolReply {
  /**
   * Gets a value indicating whether the tool did what was asked.
   */
  readonly ok: boolean;

  /**
   * Gets what the model is told.
   */
  readonly text: string;
}

/**
 * The input to {@link TEAM_START_WORKER}.
 */
export interface StartWorkerInput {
  /**
   * Gets a short name for the task, shown in the user's list of workers and on the board.
   */
  readonly title: string;

  /**
   * Gets the task: what to do, and what done looks like.
   */
  readonly task: string;

  /**
   * Gets the branch the worker works on, created when it does not exist.
   */
  readonly branch: string;

  /**
   * Gets the branch a new {@link branch} starts from, or undefined for the repository's default.
   */
  readonly base?: string;
}

/**
 * The input to {@link TEAM_INSTRUCT_WORKER}.
 */
export interface InstructWorkerInput {
  /**
   * Gets the worker, by id or title.
   */
  readonly worker: string;

  /**
   * Gets the instructions.
   */
  readonly text: string;
}

/**
 * The input to {@link TEAM_STOP_WORKER} and, with the worker optional, {@link TEAM_WORKER_STATUS}.
 */
export interface WorkerRefInput {
  /**
   * Gets the worker, by id or title.
   */
  readonly worker: string;
}

/**
 * The input to {@link TEAM_READ_BOARD}.
 */
export interface ReadBoardInput {
  /**
   * Gets the sequence of the last entry already seen, so only newer ones are returned; omitted for the
   * whole board.
   */
  readonly since?: number;
}

/**
 * The input to {@link TEAM_POST_TO_BOARD}.
 */
export interface PostToBoardInput {
  /**
   * Gets what the entry says about the author's work.
   */
  readonly kind: TeamBoardKind;

  /**
   * Gets what it says.
   */
  readonly text: string;
}

/**
 * The input to {@link TEAM_COMPLETE_TASK}.
 */
export interface CompleteTaskInput {
  /**
   * Gets what was done, for the lead.
   */
  readonly summary: string;

  /**
   * Gets the pull request opened for the work, when one was.
   */
  readonly pullRequest?: string;
}

/**
 * The input to {@link TEAM_FAIL_TASK}.
 */
export interface FailTaskInput {
  /**
   * Gets why the task cannot be finished.
   */
  readonly reason: string;
}

/**
 * The most workers a container runs at once (#788): those not yet completed, failed or cancelled.
 * Each is a held-open session, and the main process keeps eight; this leaves room for the lead and the
 * user's other agents. A fixed bound for the spike, to become a setting.
 */
export const MAX_ACTIVE_WORKERS: number = 4;

/**
 * The longest title accepted, in characters.
 */
export const MAX_TEAM_TITLE: number = 80;

/**
 * The longest task, instruction, summary or board entry accepted, in characters. Each becomes another
 * agent's prompt, so it is bounded like any prompt from a source the user did not type.
 */
export const MAX_TEAM_TEXT: number = 8000;

/**
 * The longest branch name accepted, in characters.
 */
const MAX_BRANCH: number = 200;

/**
 * Validates a branch name before it reaches git: git's own rules for a ref name, plus no leading dash
 * so it can never be read as an option. Applied in the renderer, where the team acts, and again in the
 * main process, which treats the renderer as hostile.
 * @param value The candidate.
 * @returns Returns true when the value is a safe branch name.
 */
export function isSafeBranchName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_BRANCH) {
    return false;
  }
  if (value.startsWith('-') || value.startsWith('/') || value.endsWith('/')) {
    return false;
  }
  if (value.endsWith('.') || value.endsWith('.lock') || value === '@') {
    return false;
  }
  if (value.includes('..') || value.includes('//') || value.includes('@{')) {
    return false;
  }
  // Control characters, space, and the characters git reserves: ~ ^ : ? * [ \
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(value)) {
    return false;
  }
  return value
    .split('/')
    .every((segment: string): boolean => segment.length > 0 && !segment.startsWith('.'));
}

/**
 * Trims and bounds a string from the model.
 * @param value The candidate.
 * @param max The longest accepted.
 * @returns Returns the trimmed, bounded string, or null when it is not a non-empty string.
 */
export function boundedText(value: unknown, max: number = MAX_TEAM_TEXT): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed: string = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

/**
 * Parses a {@link StartWorkerInput} from an untrusted request.
 * @param value The candidate.
 * @returns Returns the input, or the reason it was refused.
 */
export function parseStartWorkerInput(value: unknown): StartWorkerInput | string {
  const record: Record<string, unknown> = asRecord(value);
  const title: string | null = boundedText(record['title'], MAX_TEAM_TITLE);
  if (title === null) {
    return 'A worker needs a title: a few words naming its task.';
  }
  const task: string | null = boundedText(record['task']);
  if (task === null) {
    return 'A worker needs a task: what to do, and what done looks like.';
  }
  const branch: unknown = typeof record['branch'] === 'string' ? record['branch'].trim() : null;
  if (!isSafeBranchName(branch)) {
    return `"${String(record['branch'])}" is not a branch name git accepts.`;
  }
  const base: unknown = typeof record['base'] === 'string' ? record['base'].trim() : undefined;
  if (base !== undefined && base !== '' && !isSafeBranchName(base)) {
    return `"${String(record['base'])}" is not a branch name git accepts.`;
  }
  return {
    title,
    task,
    branch,
    ...(typeof base === 'string' && base.length > 0 ? { base } : {}),
  };
}

/**
 * Parses a {@link PostToBoardInput} from an untrusted request.
 * @param value The candidate.
 * @returns Returns the input, or the reason it was refused.
 */
export function parsePostToBoardInput(value: unknown): PostToBoardInput | string {
  const record: Record<string, unknown> = asRecord(value);
  const kind: unknown = record['kind'];
  if (!TEAM_BOARD_KINDS.includes(kind as TeamBoardKind)) {
    return `A board entry is one of: ${TEAM_BOARD_KINDS.join(', ')}.`;
  }
  const text: string | null = boundedText(record['text']);
  if (text === null) {
    return 'A board entry needs some text.';
  }
  return { kind: kind as TeamBoardKind, text };
}

/**
 * Reads a value as a record, treating anything else as empty.
 * @param value The candidate.
 * @returns Returns the record.
 */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
