import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Categorises a build task so the ribbon can offer a Build / Run / Test action for the active
 * workspace.
 */
export type BuildGroup = 'build' | 'run' | 'test' | 'other';

/**
 * Describes a discovered build/run/test task for a workspace.
 */
export interface BuildTask {
  /**
   * Gets the task's stable identifier within its workspace (for example `dotnet:build`).
   */
  readonly id: string;

  /**
   * Gets the human-readable label.
   */
  readonly label: string;

  /**
   * Gets the group the task belongs to.
   */
  readonly group: BuildGroup;

  /**
   * Gets the shell command line the task runs.
   */
  readonly command: string;

  /**
   * Gets the absolute working directory the task runs in (the workspace root).
   */
  readonly cwd: string;
}

/**
 * The contract a workspace's build runner exposes to the {@link Builds} seam so the root ribbon can
 * drive it.
 */
export interface BuildHandler {
  /**
   * Gets the tasks discovered for the workspace.
   */
  readonly tasks: Signal<readonly BuildTask[]>;

  /**
   * Gets whether a task is currently running.
   */
  readonly running: Signal<boolean>;

  /**
   * Runs the task with the given identifier.
   * @param taskId The task to run.
   */
  run(taskId: string): void;

  /**
   * Cancels the running task, if any.
   */
  cancel(): void;
}

/**
 * Routes the root ribbon's build/run/test actions to the active workspace's build runner.
 *
 * Each workspace's {@link import('./build-runner').BuildRunner} registers as the handler while its
 * directory tab is active; the root {@link import('../../components/strips/ribbon-strip/ribbons/directory-ribbon/directory-ribbon').DirectoryRibbon}
 * reads the exposed signals and calls the action methods, which forward to the registered handler (or
 * do nothing when no workspace is active). This mirrors the editor-command seam.
 */
@Service()
export class Builds {
  /**
   * Holds the active workspace's build handler, or null when no workspace is active.
   */
  private readonly handler: WritableSignal<BuildHandler | null> = signal<BuildHandler | null>(null);

  /**
   * Holds the task chosen in the ribbon's task picker, or null to use the default.
   */
  private readonly selected: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the tasks discovered for the active workspace.
   */
  public readonly tasks: Signal<readonly BuildTask[]> = computed(
    (): readonly BuildTask[] => this.handler()?.tasks() ?? [],
  );

  /**
   * Gets whether the active workspace is running a task.
   */
  public readonly running: Signal<boolean> = computed(
    (): boolean => this.handler()?.running() ?? false,
  );

  /**
   * Gets whether the active workspace has a runnable build task.
   */
  public readonly canBuild: Signal<boolean> = computed(
    (): boolean => this.firstOf('build') !== undefined,
  );

  /**
   * Gets whether the active workspace has a runnable run task.
   */
  public readonly canRun: Signal<boolean> = computed(
    (): boolean => this.firstOf('run') !== undefined,
  );

  /**
   * Gets whether the active workspace has a runnable test task.
   */
  public readonly canTest: Signal<boolean> = computed(
    (): boolean => this.firstOf('test') !== undefined,
  );

  /**
   * Gets the task the Start action runs: the picked task when it is still available, otherwise the
   * default run task, then the default build task, then the first discovered task.
   */
  public readonly startTask: Signal<BuildTask | undefined> = computed((): BuildTask | undefined => {
    const tasks: readonly BuildTask[] = this.tasks();
    const picked: BuildTask | undefined = tasks.find(
      (task: BuildTask): boolean => task.id === this.selected(),
    );
    return picked ?? this.firstOf('run') ?? this.firstOf('build') ?? tasks[0];
  });

  /**
   * Gets the label of the task the Start action runs, or an empty string when there is none.
   */
  public readonly startLabel: Signal<string> = computed(
    (): string => this.startTask()?.label ?? '',
  );

  /**
   * Gets whether there is a task the Start action can run.
   */
  public readonly canStart: Signal<boolean> = computed(
    (): boolean => this.startTask() !== undefined,
  );

  /**
   * Registers the active workspace's build handler.
   * @param handler The handler to register.
   */
  public register(handler: BuildHandler): void {
    this.handler.set(handler);
  }

  /**
   * Unregisters the given handler, if it is the currently registered one.
   * @param handler The handler to unregister.
   */
  public unregister(handler: BuildHandler): void {
    if (this.handler() === handler) {
      this.handler.set(null);
    }
  }

  /**
   * Runs a task by identifier on the active workspace.
   * @param taskId The task to run.
   */
  public runTask(taskId: string): void {
    this.handler()?.run(taskId);
  }

  /**
   * Runs the active workspace's default build task.
   */
  public build(): void {
    this.runFirst('build');
  }

  /**
   * Selects the task the Start action runs.
   * @param taskId The task to select.
   */
  public select(taskId: string): void {
    this.selected.set(taskId);
  }

  /**
   * Runs the selected task (or the default when none is picked).
   */
  public start(): void {
    const task: BuildTask | undefined = this.startTask();
    if (task !== undefined) {
      this.handler()?.run(task.id);
    }
  }

  /**
   * Runs the active workspace's default test task.
   */
  public test(): void {
    this.runFirst('test');
  }

  /**
   * Cancels the active workspace's running task, if any.
   */
  public cancel(): void {
    this.handler()?.cancel();
  }

  /**
   * Runs the first task of a group on the active workspace, when one exists.
   * @param group The group whose first task is run.
   */
  private runFirst(group: BuildGroup): void {
    const task: BuildTask | undefined = this.firstOf(group);
    if (task !== undefined) {
      this.handler()?.run(task.id);
    }
  }

  /**
   * Finds the first discovered task of a group.
   * @param group The group to search.
   * @returns Returns the first task of the group, or undefined when none exists.
   */
  private firstOf(group: BuildGroup): BuildTask | undefined {
    return this.tasks().find((task: BuildTask): boolean => task.group === group);
  }
}
