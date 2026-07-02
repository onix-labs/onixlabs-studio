import { inject, Service } from '@angular/core';
import { EditorTerminals } from '@shared/angular/services/editor-terminals/editor-terminals';
import { Task, TaskContext, TaskProvider } from './task';

/**
 * Orchestrates tasks whose output is presented interactively: it holds the registered
 * {@link TaskProvider}s, discovers their tasks, and runs a `terminal`-target task by queuing it into
 * its code tab's docked terminal (the run-file behaviour). It is a root singleton.
 *
 * Captured (`output`-target) build tasks are run per workspace by
 * {@link import('./build-runner').BuildRunner} instead, so their output streams into that workspace's
 * Output panel and their problems into its Problems panel.
 */
@Service()
export class Tasks {
  /**
   * Holds the docked-terminal state that `terminal` tasks are queued into.
   */
  private readonly editorTerminals: EditorTerminals = inject(EditorTerminals);

  /**
   * Holds the registered providers, keyed by identifier.
   */
  private readonly providers: Map<string, TaskProvider> = new Map<string, TaskProvider>();

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
      [...this.providers.values()].map(
        (provider: TaskProvider): Promise<Task[]> =>
          Promise.resolve(provider.provideTasks(context)),
      ),
    );
    return lists.flat();
  }

  /**
   * Runs a task by resolving its command and queuing it into its code tab's docked terminal. Only
   * `terminal`-target tasks run here; an `output`-target task is a no-op (such tasks are run per
   * workspace by the build runner).
   * @param task The task to run.
   */
  public async run(task: Task): Promise<void> {
    if (task.target !== 'terminal' || task.terminalTabId === undefined) {
      return;
    }
    const command: string | null = await task.resolve();
    if (command !== null) {
      this.editorTerminals.queueCommand(task.terminalTabId, command);
    }
  }
}
