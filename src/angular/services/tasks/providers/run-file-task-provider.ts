import { inject, Service } from '@angular/core';
import { RunApi, TempFileResult } from '../../../../shared/studio-api';
import { ActiveDocumentContext, Task, TaskContext, TaskProvider } from '../task';
import { Tasks } from '../tasks';

/**
 * Describes how a given language is run.
 */
interface LanguageRunner {
  /**
   * Gets the file extension the source is written under.
   */
  readonly extension: string;

  /**
   * Builds the shell command that runs the source file.
   * @param filePath The absolute path of the source file.
   * @returns Returns the command to run.
   */
  buildCommand(filePath: string): string;
}

/**
 * Quotes a path for safe use in a shell command.
 * @param filePath The path to quote.
 * @returns Returns the double-quoted path.
 */
function quote(filePath: string): string {
  return `"${filePath}"`;
}

/**
 * Maps Monaco language identifiers to their runner. A language without an entry cannot be run.
 */
const RUNNERS: Readonly<Record<string, LanguageRunner>> = {
  javascript: { extension: '.js', buildCommand: (p: string): string => `node ${quote(p)}` },
  typescript: { extension: '.ts', buildCommand: (p: string): string => `tsx ${quote(p)}` },
  python: { extension: '.py', buildCommand: (p: string): string => `python3 ${quote(p)}` },
  shell: { extension: '.sh', buildCommand: (p: string): string => `bash ${quote(p)}` },
  csharp: { extension: '.cs', buildCommand: (p: string): string => `dotnet run ${quote(p)}` },
};

/**
 * Holds the provider identifier.
 */
const PROVIDER_ID: string = 'run-file';

/**
 * Contributes a task that runs the active code document. This is the first task provider — the
 * generalisation of the original `CodeRunner` — and runs its task in the code tab's docked,
 * interactive terminal (the `terminal` target), so running a file behaves exactly as it did before.
 * It registers itself with the {@link Tasks} orchestrator on construction.
 */
@Service()
export class RunFileTaskProvider implements TaskProvider {
  /**
   * Gets the provider identifier.
   */
  public readonly id: string = PROVIDER_ID;

  /**
   * Holds the run bridge used to write the document to a temporary file, or undefined outside Electron.
   */
  private readonly api: RunApi | undefined = window.studio?.run;

  /**
   * Initializes the provider, registering it with the task orchestrator.
   */
  public constructor() {
    inject(Tasks).register(this);
  }

  /**
   * Determines whether a language can be run.
   * @param language The Monaco language identifier.
   * @returns Returns true when a runner exists for the language.
   */
  public canRun(language: string): boolean {
    return RUNNERS[language] !== undefined;
  }

  /**
   * Builds the run-file task for a code document, or null when its language cannot be run.
   * @param document The active document descriptor.
   * @returns Returns the task, or null when the language has no runner.
   */
  public buildTask(document: ActiveDocumentContext): Task | null {
    const runner: LanguageRunner | undefined = RUNNERS[document.language];
    if (runner === undefined) {
      return null;
    }
    return {
      id: PROVIDER_ID,
      label: 'Run File',
      source: PROVIDER_ID,
      target: 'terminal',
      terminalTabId: document.tabId,
      resolve: (): Promise<string | null> => this.resolveCommand(document, runner),
    };
  }

  /**
   * Discovers the run-file task for the active document, when one is runnable.
   * @param context The discovery context.
   * @returns Returns the run-file task, or an empty list.
   */
  public provideTasks(context: TaskContext): Task[] {
    const document: ActiveDocumentContext | undefined = context.activeDocument;
    if (document === undefined) {
      return [];
    }
    const task: Task | null = this.buildTask(document);
    return task === null ? [] : [task];
  }

  /**
   * Writes the document to its temporary run file and builds the command that runs it.
   * @param document The active document descriptor.
   * @param runner The runner for the document's language.
   * @returns Returns the command to run, or null when the file could not be written.
   */
  private async resolveCommand(
    document: ActiveDocumentContext,
    runner: LanguageRunner,
  ): Promise<string | null> {
    if (this.api === undefined) {
      return null;
    }
    const result: TempFileResult = await this.api.writeTempFile(
      document.tabId,
      runner.extension,
      document.content,
    );
    if (!result.success || result.path === undefined) {
      return null;
    }
    return runner.buildCommand(result.path);
  }
}
