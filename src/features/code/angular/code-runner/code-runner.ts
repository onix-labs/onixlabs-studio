import { inject, Service } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { RunFileTaskProvider } from '@shared/angular/services/tasks/providers/run-file-task-provider';
import { Task } from '@shared/angular/services/tasks/task';
import { Tasks } from '@shared/angular/services/tasks/tasks';

/**
 * Runs the active code document. This is now a thin facade over the task model: it builds the
 * run-file task through {@link RunFileTaskProvider} and runs it through {@link Tasks}, which queues it
 * into the tab's docked terminal. The original per-language behaviour is preserved.
 */
@Service()
export class CodeRunner {
  /**
   * Holds the task orchestrator the run is dispatched through.
   */
  private readonly tasks: Tasks = inject(Tasks);

  /**
   * Holds the run-file provider that builds the task for a document.
   */
  private readonly provider: RunFileTaskProvider = inject(RunFileTaskProvider);

  /**
   * Holds the structured logger for the code runner.
   */
  private readonly log: Log = inject(Log);

  /**
   * Returns whether the given language can be run.
   * @param language The Monaco language identifier.
   * @returns Returns true when a runner exists for the language.
   */
  public canRun(language: string): boolean {
    return this.provider.canRun(language);
  }

  /**
   * Runs the given content for a tab by building and dispatching the run-file task. Does nothing when
   * the language has no runner.
   * @param tabId The owning tab identifier.
   * @param language The Monaco language identifier.
   * @param content The source content to run.
   */
  public async run(tabId: string, language: string, content: string): Promise<void> {
    this.log.info('code.runner', 'Run requested', tabId, language);
    const task: Task | null = this.provider.buildTask({ tabId, language, content });
    if (task === null) {
      this.log.warn('code.runner', 'No runner for language; run skipped', language);
      return;
    }
    this.log.debug('code.runner', 'Dispatching run task', task.id);
    await this.tasks.run(task);
  }
}
