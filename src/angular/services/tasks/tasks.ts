import { inject, Service } from '@angular/core';
import { TaskApi } from '../../../shared/task-types';
import { CodeTerminals } from '../code-terminals/code-terminals';
import { Output } from '../output/output';
import { Task, TaskContext, TaskProvider } from './task';

/**
 * Holds the bookkeeping for a single in-flight `output` task run.
 */
interface ActiveRun {
  /**
   * Gets the task being run.
   */
  readonly task: Task;
}

/**
 * Orchestrates tasks: holds the registered {@link TaskProvider}s, discovers their tasks, and runs a
 * task by dispatching it to the right facility for its target. A `terminal` task is queued into its
 * code tab's docked terminal (interactive, unchanged from the original run-file behaviour); an
 * `output` task runs as a captured child process in the main process whose output streams into the
 * shared {@link Output} channel. It is a root singleton shared across the application.
 */
@Service()
export class Tasks {
  /**
   * Holds the shared Output channel that `output` task output streams into.
   */
  private readonly output: Output = inject(Output);

  /**
   * Holds the docked-terminal state that `terminal` tasks are queued into.
   */
  private readonly codeTerminals: CodeTerminals = inject(CodeTerminals);

  /**
   * Holds the task-runner bridge, or undefined when running outside Electron.
   */
  private readonly api: TaskApi | undefined = window.studio?.tasks;

  /**
   * Holds the registered providers, keyed by identifier.
   */
  private readonly providers: Map<string, TaskProvider> = new Map<string, TaskProvider>();

  /**
   * Holds the in-flight `output` runs, keyed by run identifier.
   */
  private readonly active: Map<string, ActiveRun> = new Map<string, ActiveRun>();

  /**
   * Initializes the service, subscribing to task output and exit from the main process.
   */
  public constructor() {
    this.api?.onOutput((runId: string, chunk: string): void => this.onOutput(runId, chunk));
    this.api?.onExit((runId: string, code: number | null, signal: string | null): void =>
      this.onExit(runId, code, signal),
    );
  }

  /**
   * Registers a task provider, replacing any provider with the same identifier.
   * @param provider The provider to register.
   */
  public register(provider: TaskProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Removes a registered provider.
   * @param id The identifier of the provider to remove.
   */
  public unregister(id: string): void {
    this.providers.delete(id);
  }

  /**
   * Discovers the tasks contributed by every registered provider for the given context.
   * @param context The context to discover tasks against.
   * @returns Returns the aggregated tasks.
   */
  public async getTasks(context: TaskContext): Promise<Task[]> {
    const lists: Task[][] = await Promise.all(
      [...this.providers.values()].map((provider: TaskProvider): Promise<Task[]> =>
        Promise.resolve(provider.provideTasks(context)),
      ),
    );
    return lists.flat();
  }

  /**
   * Runs a task, resolving its command and dispatching it to the facility for its target. A `terminal`
   * task is queued into its docked terminal; an `output` task runs as a captured child process whose
   * output streams into the Output channel.
   * @param task The task to run.
   */
  public async run(task: Task): Promise<void> {
    const command: string | null = await task.resolve();
    if (command === null) {
      return;
    }
    if (task.target === 'terminal') {
      if (task.terminalTabId !== undefined) {
        this.codeTerminals.queueCommand(task.terminalTabId, command);
      }
      return;
    }
    await this.runInOutput(task, command);
  }

  /**
   * Cancels a running `output` task.
   * @param runId The run to cancel.
   */
  public cancel(runId: string): void {
    void this.api?.cancel(runId);
  }

  /**
   * Runs a resolved command as an `output` task, streaming its output into the Output channel.
   * @param task The task being run.
   * @param command The resolved command line.
   */
  private async runInOutput(task: Task, command: string): Promise<void> {
    if (this.api === undefined) {
      return;
    }
    const runId: string = crypto.randomUUID();
    this.active.set(runId, { task });
    this.output.appendLine(`> ${task.label}`);
    const result: { success: boolean; error?: string } = await this.api.run({
      runId,
      command,
      cwd: task.cwd,
    });
    if (!result.success) {
      this.output.appendLine(result.error ?? 'Failed to start task.');
      this.active.delete(runId);
    }
  }

  /**
   * Appends a chunk of task output to the Output channel.
   * @param runId The run the chunk belongs to.
   * @param chunk The output chunk.
   */
  private onOutput(runId: string, chunk: string): void {
    if (this.active.has(runId)) {
      this.output.append(chunk);
    }
  }

  /**
   * Writes an exit footer for a finished run and stops tracking it.
   * @param runId The run that exited.
   * @param code The exit code, or null when terminated by a signal.
   * @param signal The terminating signal, or null when exited normally.
   */
  private onExit(runId: string, code: number | null, signal: string | null): void {
    const run: ActiveRun | undefined = this.active.get(runId);
    if (run === undefined) {
      return;
    }
    this.active.delete(runId);
    const status: string =
      signal !== null ? `terminated (${signal})` : `exited with code ${code ?? 0}`;
    this.output.appendLine(`> ${run.task.label} ${status}`);
  }
}
