import { ChildProcess, fork } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { ExecuteRequest } from '../../protocol/database/protocol';
import { describeError, EngineExecution } from '../../protocol/database/engine';
import { runScript } from './sqlite-run';

/**
 * What the plugin tells a runner.
 */
type RunnerCommand =
  | { readonly kind: 'open'; readonly file: string; readonly readOnly: boolean }
  | {
      readonly kind: 'run';
      readonly id: string;
      readonly text: string;
      readonly firstLine: number;
    };

/**
 * What a runner answers.
 */
type RunnerReply =
  | { readonly kind: 'done'; readonly id: string; readonly execution: EngineExecution }
  | { readonly kind: 'failed'; readonly id: string; readonly message: string };

/**
 * A run waiting for its runner.
 */
interface Waiting {
  readonly id: string;
  readonly resolve: (execution: EngineExecution) => void;
}

/**
 * The argument that starts this plugin's bundle as a query runner rather than as the plugin.
 */
export const RUNNER_ARGUMENT: string = '--sqlite-runner';

/**
 * The process one SQLite session's queries run in, over a connection of its own to the session's file.
 *
 * A query runs here rather than in the plugin because `node:sqlite` is synchronous: in the plugin a
 * long query would stop it answering anything — the tree, a second query, a cancel. And it is a
 * process rather than a thread because SQLite cannot be interrupted from outside a statement, and a
 * thread cannot be stopped while it is inside one; a process can be killed whatever it is doing. So
 * killing this process is how a run is cancelled, and the next run starts a new one. Runs on one
 * session are queued, one at a time, as they are on one connection anywhere.
 */
export class SqliteRunner {
  /**
   * Holds the runner process, while there is one.
   */
  private child: ChildProcess | null = null;

  /**
   * Holds the run in progress, if any.
   */
  private current: Waiting | null = null;

  /**
   * Holds the runs waiting their turn.
   */
  private readonly queue: { readonly request: ExecuteRequest; readonly waiting: Waiting }[] = [];

  /**
   * Initializes a new instance of the {@link SqliteRunner} class.
   * @param script The script the runner starts from: this plugin's own bundle.
   * @param file The database file.
   * @param readOnly Whether the file is opened read-only.
   */
  public constructor(
    private readonly script: string,
    private readonly file: string,
    private readonly readOnly: boolean,
  ) {}

  /**
   * Runs a script, after any already queued on this session.
   * @param request The execution.
   * @returns Returns a promise resolving what it produced; it never rejects.
   */
  public run(request: ExecuteRequest): Promise<EngineExecution> {
    return new Promise<EngineExecution>((resolve: (execution: EngineExecution) => void): void => {
      this.queue.push({ request, waiting: { id: request.id, resolve } });
      this.next();
    });
  }

  /**
   * Cancels a run: one waiting its turn is dropped; the one in progress has its runner killed.
   * @param id The execution's id.
   */
  public cancel(id: string): void {
    const queued: number = this.queue.findIndex(
      (entry: { readonly waiting: Waiting }): boolean => entry.waiting.id === id,
    );
    if (queued >= 0) {
      const [entry] = this.queue.splice(queued, 1);
      entry?.waiting.resolve(cancelled());
      return;
    }
    if (this.current?.id === id) {
      const waiting: Waiting = this.current;
      this.current = null;
      this.stop();
      waiting.resolve(cancelled());
      this.next();
    }
  }

  /**
   * Stops the runner for good, failing any run still waiting.
   */
  public close(): void {
    const left: Waiting[] = [
      ...(this.current === null ? [] : [this.current]),
      ...this.queue.splice(0).map((entry: { readonly waiting: Waiting }): Waiting => entry.waiting),
    ];
    this.current = null;
    this.stop();
    for (const waiting of left) {
      waiting.resolve(failed('The connection was closed.'));
    }
  }

  /**
   * Starts the next queued run when none is in progress.
   */
  private next(): void {
    if (this.current !== null) {
      return;
    }
    const entry: { readonly request: ExecuteRequest; readonly waiting: Waiting } | undefined =
      this.queue.shift();
    if (entry === undefined) {
      return;
    }
    this.current = entry.waiting;
    const command: RunnerCommand = {
      kind: 'run',
      id: entry.request.id,
      text: entry.request.text,
      firstLine: entry.request.firstLine,
    };
    this.runner().send(command);
  }

  /**
   * Gets the runner, starting it and opening its connection when there is none. It runs under the
   * same runtime as the plugin — Studio's own, which the plugin's environment already selects.
   * @returns Returns the runner process.
   */
  private runner(): ChildProcess {
    if (this.child !== null) {
      return this.child;
    }
    const child: ChildProcess = fork(this.script, [RUNNER_ARGUMENT], {
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    child.on('message', (reply: RunnerReply): void => this.settle(reply));
    child.on('error', (error: Error): void => this.lost(child, describeError(error)));
    child.on('exit', (): void => this.lost(child, 'The query runner stopped.'));
    const open: RunnerCommand = { kind: 'open', file: this.file, readOnly: this.readOnly };
    child.send(open);
    this.child = child;
    return child;
  }

  /**
   * Hands a run's answer to whoever is waiting for it, then starts the next.
   * @param reply The runner's answer.
   */
  private settle(reply: RunnerReply): void {
    if (this.current?.id !== reply.id) {
      return;
    }
    const waiting: Waiting = this.current;
    this.current = null;
    waiting.resolve(reply.kind === 'done' ? reply.execution : failed(reply.message));
    this.next();
  }

  /**
   * Notes that a runner died on its own, failing the run it was doing.
   * @param child The runner.
   * @param message Why.
   */
  private lost(child: ChildProcess, message: string): void {
    if (this.child !== child) {
      return;
    }
    this.child = null;
    const waiting: Waiting | null = this.current;
    this.current = null;
    waiting?.resolve(failed(message));
    this.next();
  }

  /**
   * Kills the runner, if there is one — mid-statement if need be, which is the point.
   */
  private stop(): void {
    const child: ChildProcess | null = this.child;
    this.child = null;
    child?.kill('SIGKILL');
  }
}

/**
 * Serves as a query runner: opens the session's file on its own connection and runs each script it is
 * sent, answering with what the script produced. Called by the plugin's entry point when it is started
 * with {@link RUNNER_ARGUMENT}. It exits when the plugin goes, so a plugin that is killed leaves no
 * runner behind.
 */
export function serveAsRunner(): void {
  const send: ((reply: RunnerReply) => boolean) | undefined = process.send?.bind(process);
  if (send === undefined) {
    return;
  }
  process.on('disconnect', (): never => process.exit(0));
  let database: DatabaseSync | null = null;
  let opening: string | null = null;
  process.on('message', (command: RunnerCommand): void => {
    if (command.kind === 'open') {
      try {
        database = new DatabaseSync(command.file, { readOnly: command.readOnly });
        database.exec('pragma busy_timeout = 3000');
      } catch (error: unknown) {
        opening = describeError(error);
      }
      return;
    }
    if (database === null) {
      const reply: RunnerReply = {
        kind: 'failed',
        id: command.id,
        message: opening ?? 'The database is not open.',
      };
      send(reply);
      return;
    }
    const reply: RunnerReply = {
      kind: 'done',
      id: command.id,
      execution: runScript(database, command.text, command.firstLine),
    };
    send(reply);
  });
}

/**
 * The outcome of a run that was cancelled.
 * @returns Returns the execution.
 */
function cancelled(): EngineExecution {
  return {
    resultSets: [],
    messages: [{ severity: 'warning', text: 'The query was cancelled.' }],
    failed: false,
    cancelled: true,
  };
}

/**
 * The outcome of a run that could not happen.
 * @param message Why.
 * @returns Returns the execution.
 */
function failed(message: string): EngineExecution {
  return {
    resultSets: [],
    messages: [{ severity: 'error', text: message }],
    failed: true,
    cancelled: false,
  };
}
