import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';
import { ProjectAction } from '@shared/api/project-system';
import { RunConfiguration } from '@shared/api/studio';

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
 * One in-flight run of a task or run configuration. Several may be live at once — a workspace can run its
 * back end, its front end, and a test watcher side by side — so each carries the identity the Stop menu
 * needs to name it and stop it alone.
 */
export interface ActiveRun {
  /**
   * Gets the run's unique identifier, assigned when it is launched. Distinct per run, so the same
   * configuration started twice yields two runs.
   */
  readonly id: string;

  /**
   * Gets the display label of what is running (the configuration or task name).
   */
  readonly label: string;

  /**
   * Gets the id of the task or run configuration backing the run, shared by every run of it.
   */
  readonly taskId: string;

  /**
   * Gets the epoch-millisecond timestamp the run was launched at, which tells two runs of the same
   * configuration apart.
   */
  readonly startedAt: number;
}

/**
 * The options accompanying a build-flavoured action (Build/Rebuild/Clean/test).
 */
export interface BuildActionOptions {
  /**
   * Gets whether a busy build terminal may be stopped and replaced by this action. Set after the
   * user confirms the stop-and-restart prompt; without it a busy build leaves the request ignored
   * (the ribbon asks before ever dispatching into a busy build).
   */
  readonly restart?: boolean;
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
   * Gets the workspace's in-flight runs, in launch order.
   */
  readonly activeRuns: Signal<readonly ActiveRun[]>;

  /**
   * Gets whether the workspace's build terminal is busy (a build, clean, or test is in flight).
   */
  readonly buildBusy: Signal<boolean>;

  /**
   * Runs the task with the given identifier.
   * @param taskId The task to run.
   * @param options The action options.
   */
  run(taskId: string, options?: BuildActionOptions): void;

  /**
   * Runs a `.studio` run configuration, compiling it to a command and executing it like a task. A
   * compound launches each of its members as its own run.
   * @param configuration The run configuration to run.
   * @param siblings Every configuration in the workspace, used to resolve a compound's members.
   */
  runConfiguration(configuration: RunConfiguration, siblings: readonly RunConfiguration[]): void;

  /**
   * Runs a capability action (Build/Clean/Rebuild…), compiling it to a command for the workspace's
   * ecosystem and executing it. Distinct from the discovered tasks, so these never appear in the Run
   * dropdown.
   * @param action The action to run.
   * @param options The action options.
   */
  runAction(action: ProjectAction, options?: BuildActionOptions): void;

  /**
   * Cancels one in-flight run.
   * @param runId The run to cancel.
   */
  cancel(runId: string): void;

  /**
   * Cancels every in-flight run.
   */
  cancelAll(): void;
}

/**
 * Routes the root ribbon's build/run/test actions to the active workspace's build runner.
 *
 * Each workspace's {@link import('./build-runner').BuildRunner} registers as the handler while its
 * directory tab is active; the active workspace's ribbon reads the exposed signals and calls the
 * action methods, which forward to the registered handler (or do nothing when no workspace is
 * active). This mirrors the editor-command seam.
 */
@Service()
export class Builds {
  /**
   * Holds the active workspace's build handler, or null when no workspace is active.
   */
  private readonly handler: WritableSignal<BuildHandler | null> = signal<BuildHandler | null>(null);

  /**
   * Gets the build/test tasks discovered for the active workspace. These drive the Solution group's
   * Build action only — the Run dropdown is fed exclusively by authored `.studio` run configurations.
   */
  public readonly tasks: Signal<readonly BuildTask[]> = computed(
    (): readonly BuildTask[] => this.handler()?.tasks() ?? [],
  );

  /**
   * Gets the active workspace's in-flight runs, in launch order.
   */
  public readonly activeRuns: Signal<readonly ActiveRun[]> = computed(
    (): readonly ActiveRun[] => this.handler()?.activeRuns() ?? [],
  );

  /**
   * Gets whether the active workspace has anything running.
   */
  public readonly running: Signal<boolean> = computed(
    (): boolean => this.activeRuns().length > 0,
  );

  /**
   * Gets whether the active workspace has a runnable build task.
   */
  public readonly canBuild: Signal<boolean> = computed(
    (): boolean => this.firstOf('build') !== undefined,
  );

  /**
   * Gets whether the active workspace's build terminal is busy (a build, clean, or test in flight).
   */
  public readonly buildBusy: Signal<boolean> = computed(
    (): boolean => this.handler()?.buildBusy() ?? false,
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
   * Runs a `.studio` run configuration on the active workspace. A compound launches each of its members
   * as its own run, in parallel.
   * @param configuration The run configuration to run.
   * @param siblings Every configuration in the workspace, used to resolve a compound's members.
   */
  public runConfiguration(
    configuration: RunConfiguration,
    siblings: readonly RunConfiguration[] = [],
  ): void {
    this.handler()?.runConfiguration(configuration, siblings);
  }

  /**
   * Runs a capability action (Build/Clean/Rebuild…) on the active workspace.
   * @param action The action to run.
   * @param options The action options.
   */
  public runAction(action: ProjectAction, options?: BuildActionOptions): void {
    this.handler()?.runAction(action, options);
  }

  /**
   * Runs the active workspace's default build task.
   * @param options The action options.
   */
  public build(options?: BuildActionOptions): void {
    this.runFirst('build', options);
  }

  /**
   * Cancels one in-flight run on the active workspace.
   * @param runId The run to cancel.
   */
  public cancel(runId: string): void {
    this.handler()?.cancel(runId);
  }

  /**
   * Cancels every in-flight run on the active workspace.
   */
  public cancelAll(): void {
    this.handler()?.cancelAll();
  }

  /**
   * Runs the first task of a group on the active workspace, when one exists.
   * @param group The group whose first task is run.
   * @param options The action options.
   */
  private runFirst(group: BuildGroup, options?: BuildActionOptions): void {
    const task: BuildTask | undefined = this.firstOf(group);
    if (task !== undefined) {
      this.handler()?.run(task.id, options);
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
