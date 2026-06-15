/**
 * Identifies where a task's output is presented.
 *
 * A `terminal` task runs in a code tab's docked, interactive terminal (supporting input); a `output`
 * task runs as a captured child process whose output streams into the shared Output panel, where it
 * can later be parsed by problem matchers.
 */
export type TaskTarget = 'terminal' | 'output';

/**
 * Describes a runnable unit of work — running a file, building a project, executing a script. A task
 * is produced by a {@link TaskProvider} (or built directly for ad-hoc runs) and executed through the
 * {@link Tasks} service.
 */
export interface Task {
  /**
   * Gets a stable identifier for the task within its source (for example `run-file` or `dotnet:build`).
   */
  readonly id: string;

  /**
   * Gets the human-readable label shown for the task.
   */
  readonly label: string;

  /**
   * Gets the identifier of the provider (or facility) the task originates from.
   */
  readonly source: string;

  /**
   * Gets where the task's output is presented.
   */
  readonly target: TaskTarget;

  /**
   * Gets the working directory the task runs in, or undefined to use a sensible default. Honoured by
   * `output` tasks; `terminal` tasks run in their docked terminal's directory.
   */
  readonly cwd?: string;

  /**
   * Gets the code tab whose docked terminal a `terminal` task runs in. Required for `terminal` tasks
   * and ignored otherwise.
   */
  readonly terminalTabId?: string;

  /**
   * Resolves the shell command to run, performing any preparation the task needs (for example writing
   * the active document to a temporary file). Resolution happens at run time, not at discovery, so
   * listing a provider's tasks has no side effects.
   * @returns Returns the command line to run, or null to abort the run.
   */
  resolve(): Promise<string | null>;
}

/**
 * Describes the active code document tasks can be discovered against (for example, to run it).
 */
export interface ActiveDocumentContext {
  /**
   * Gets the owning tab identifier.
   */
  readonly tabId: string;

  /**
   * Gets the document's Monaco language identifier.
   */
  readonly language: string;

  /**
   * Gets the document's current content.
   */
  readonly content: string;
}

/**
 * Supplies the context a {@link TaskProvider} discovers tasks against.
 */
export interface TaskContext {
  /**
   * Gets the absolute workspace root, when a folder is open.
   */
  readonly workspaceRoot?: string;

  /**
   * Gets the active code document, when one is in focus.
   */
  readonly activeDocument?: ActiveDocumentContext;
}

/**
 * Discovers and contributes {@link Task}s. Providers are the extension point through which run/build
 * integrations (running the active file, building a project, running tests) are added; each provider
 * decides which tasks are available for a given {@link TaskContext}.
 */
export interface TaskProvider {
  /**
   * Gets the provider's identifier, used as the {@link Task.source} of the tasks it contributes.
   */
  readonly id: string;

  /**
   * Discovers the tasks this provider offers for the given context. Must not run anything or perform
   * expensive side effects; preparation belongs in {@link Task.resolve}.
   * @param context The context to discover tasks against.
   * @returns Returns the contributed tasks.
   */
  provideTasks(context: TaskContext): Task[] | Promise<Task[]>;
}
