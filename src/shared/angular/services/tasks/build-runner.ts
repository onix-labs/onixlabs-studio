import {
  computed,
  effect,
  inject,
  OnDestroy,
  Service,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { DirectoryEntry, DirectoryListing, OpenSelection } from '@shared/api/workspace-channels';
import { ProjectAction, ProjectEntry, ProjectModel } from '@shared/api/project-system';
import { expandRunConfiguration, RunConfiguration } from '@shared/api/studio';
import {
  Diagnostic,
  Diagnostics,
  DiagnosticsProvider,
} from '@shared/angular/services/diagnostics/diagnostics';
import { Documents } from '@shared/angular/services/documents/documents';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { TerminalBridge } from '@shared/angular/services/terminal-bridge/terminal-bridge';
import {
  DISPOSED_EXIT_CODE,
  TerminalLaunch,
  TerminalSessions,
} from '@shared/angular/services/terminal-sessions/terminal-sessions';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { ActiveRun, BuildActionOptions, BuildGroup, BuildHandler, BuildTask } from './builds';
import { MatchedProblem, parseProblems } from './problem-matcher';
import { RUN_PROJECT_MODEL } from './run-project-model';

/**
 * Identifies the diagnostics provider build problems are published under.
 */
const PROVIDER_ID: string = 'tasks';

/**
 * Matches a .NET solution or project file by extension, used to detect a .NET workspace root.
 */
const DOTNET_PROJECT_PATTERN: RegExp = /\.(sln|slnx|csproj|fsproj|vbproj)$/i;

/**
 * Matches a Gradle build or settings script (Groovy or Kotlin DSL), used to detect a Gradle workspace
 * root.
 */
const GRADLE_SCRIPT_PATTERN: RegExp = /^(build|settings)\.gradle(\.kts)?$/;

/**
 * Determines whether a path is absolute (a POSIX root or a Windows drive).
 * @param path The path to test.
 * @returns Returns true when the path is absolute.
 */
function isAbsolute(path: string): boolean {
  return /^([a-zA-Z]:[\\/]|[\\/])/.exec(path) !== null;
}

/**
 * Joins a workspace root and a possibly-relative file path into a single path.
 * @param root The workspace root.
 * @param file The file path, absolute or relative to the root.
 * @returns Returns the resolved path.
 */
function resolvePath(root: string, file: string): string {
  if (isAbsolute(file)) {
    return file;
  }
  return `${root.replace(/[\\/]+$/, '')}/${file.replace(/^[\\/]+/, '')}`;
}

/**
 * Extracts the base name from a path.
 * @param path The path.
 * @returns Returns the base name.
 */
function basename(path: string): string {
  const segments: string[] = path.split(/[\\/]/);
  return segments[segments.length - 1];
}

/**
 * Classifies a discovered task name into a build group.
 * @param name The task or script name.
 * @returns Returns the group it belongs to.
 */
function groupOf(name: string): BuildGroup {
  const lower: string = name.toLowerCase();
  if (lower.includes('test')) {
    return 'test';
  }
  if (lower.includes('build') || lower.includes('compile')) {
    return 'build';
  }
  if (lower === 'start' || lower.includes('run') || lower === 'serve' || lower === 'dev') {
    return 'run';
  }
  return 'other';
}

/**
 * Runs build/run/test tasks for a single workspace and turns their output into diagnostics. It is
 * provided per workspace (in the directory view), so its output streams into that workspace's Output
 * panel and its problems into that workspace's Problems panel.
 *
 * Tasks are discovered from the workspace's ecosystem (a `package.json`'s scripts, a `.NET` project or
 * solution). Build-flavoured tasks (build, clean, rebuild, test, capability actions) execute in the
 * workspace's single reused read-only Build terminal session — a real PTY, so toolchains colour their
 * output — one at a time: a busy build is only ever stopped and replaced after the user confirms
 * (never silently), and its output is problem-matched from the session's retained scrollback when it
 * exits. Run configurations execute as interactive run terminal sessions — one reused session per
 * configuration, so an interactive program reads the user's keystrokes, and a relaunch replaces the
 * same tab — with the configuration's environment and working directory applied. It implements
 * {@link BuildHandler} so the root ribbon can drive whichever workspace is active.
 */
@Service()
export class BuildRunner implements BuildHandler, OnDestroy {
  /**
   * Holds this workspace's diagnostics aggregate.
   */
  private readonly diagnostics: Diagnostics = inject(Diagnostics);

  /**
   * Holds this workspace's state (root and tree).
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds this workspace's documents, used to resolve a problem's file to an open document.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds this workspace's terminal sessions, hosting the reused Build terminal.
   */
  private readonly sessions: TerminalSessions = inject(TerminalSessions);

  /**
   * Holds the application-wide notification store run and build outcomes are raised to, so a
   * completion or failure surfaces even while its terminal is buried behind other panels.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the session identifiers of runs the user stopped, consumed as each stop's exit lands. A
   * stopped process exits with a real signal code (not the disposed sentinel), and a user-initiated
   * stop must not raise a failure toast — ending it was the user's own action.
   */
  private readonly stoppedRuns: Set<string> = new Set<string>();

  /**
   * Holds the terminal client, used to read the Build session's scrollback for problem matching.
   */
  private readonly terminalBridge: TerminalBridge = inject(TerminalBridge);

  /**
   * Holds the workspace's project model, when the owning view provides one, used to resolve a run
   * configuration's provider-default target (a .NET project name to its project file) instead of
   * trusting the configuration id verbatim.
   */
  private readonly projectModel: Signal<ProjectModel | null> | null = inject(RUN_PROJECT_MODEL, {
    optional: true,
  });

  /**
   * Holds the discovered tasks.
   */
  private readonly discovered: WritableSignal<readonly BuildTask[]> = signal<readonly BuildTask[]>(
    [],
  );

  /**
   * Holds the in-flight runs, in launch order.
   */
  private readonly runs: WritableSignal<readonly ActiveRun[]> = signal<readonly ActiveRun[]>([]);

  /**
   * Gets the discovered tasks.
   */
  public readonly tasks: Signal<readonly BuildTask[]> = this.discovered.asReadonly();

  /**
   * Gets the in-flight runs, in launch order.
   */
  public readonly activeRuns: Signal<readonly ActiveRun[]> = this.runs.asReadonly();

  /**
   * Gets whether anything is running.
   */
  public readonly running: Signal<boolean> = computed((): boolean => this.runs().length > 0);

  /**
   * Holds the identifier of this workspace's reused Build terminal session. Stable across launches
   * (each relaunches in place) and unique per workspace, since the main process keys PTYs globally.
   */
  private readonly buildSessionId: string = `build-${crypto.randomUUID()}`;

  /**
   * Holds whether the Build terminal is busy with an in-flight build-flavoured task.
   */
  private readonly buildBusyState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets whether the Build terminal is busy (a build, clean, rebuild, or test in flight).
   */
  public readonly buildBusy: Signal<boolean> = this.buildBusyState.asReadonly();

  /**
   * Holds the token of the current build launch, so a superseded launch's completion neither clears
   * the busy state nor publishes stale problems.
   */
  private currentBuild: symbol | null = null;

  /**
   * Holds the prefix of this workspace's run session identifiers. Each configuration reuses one
   * session (`prefix:configurationId`), stable across launches and unique per workspace, since the
   * main process keys PTYs globally.
   */
  private readonly runSessionPrefix: string = `run-${crypto.randomUUID()}`;

  /**
   * Holds the token of each running configuration's current launch, keyed by session identifier, so
   * a superseded launch's completion neither tears down the successor's run entry nor publishes
   * stale problems.
   */
  private readonly currentRuns: Map<string, symbol> = new Map<string, symbol>();

  /**
   * Holds the problems matched from each finished run's output, keyed by the task that produced them, so
   * concurrent runs do not overwrite one another's diagnostics. Re-running a task replaces its own
   * entry; the aggregate publishes the union.
   */
  private readonly problemsByTask: Map<string, readonly Diagnostic[]> = new Map<
    string,
    readonly Diagnostic[]
  >();

  /**
   * Holds the current build problems published to the diagnostics aggregate (the union of every task's).
   */
  private problems: readonly Diagnostic[] = [];

  /**
   * Holds the diagnostics aggregate's change callback while the provider is connected.
   */
  private emit: ((diagnostics: readonly Diagnostic[]) => void) | null = null;

  /**
   * Holds the function that unregisters the diagnostics provider.
   */
  private readonly unregisterProvider: () => void;

  /**
   * Initializes the runner: registers its diagnostics provider and re-discovers tasks whenever the
   * workspace root changes.
   */
  public constructor() {
    const provider: DiagnosticsProvider = {
      id: PROVIDER_ID,
      connect: (onChange: (diagnostics: readonly Diagnostic[]) => void): (() => void) => {
        this.emit = onChange;
        onChange(this.problems);
        return (): void => {
          this.emit = null;
        };
      },
    };
    this.unregisterProvider = this.diagnostics.register(provider);

    effect((): void => {
      // Re-discover whenever the workspace root changes (reading the signal registers the dependency).
      this.workspace.root();
      void this.refresh();
    });
  }

  /**
   * Re-discovers the workspace's tasks from its current root.
   * @returns Returns a promise that resolves once discovery completes.
   */
  public async refresh(): Promise<void> {
    await this.discover(this.workspace.root());
  }

  /**
   * Tears down the diagnostics provider, asking any in-flight run to stop (the terminal sessions
   * themselves are disposed by their owning store as the tab closes).
   */
  public ngOnDestroy(): void {
    this.cancelAll();
    this.unregisterProvider();
  }

  /**
   * Runs the task with the given identifier: build-flavoured tasks in the Build terminal, run-group
   * tasks in their own interactive run session. Does nothing when the task is unknown.
   * @param taskId The task to run.
   * @param options The action options.
   */
  public run(taskId: string, options?: BuildActionOptions): void {
    const task: BuildTask | undefined = this.discovered().find(
      (candidate: BuildTask): boolean => candidate.id === taskId,
    );
    if (task === undefined) {
      return;
    }
    if (task.group === 'run') {
      this.dispatchRun(task, options);
    } else {
      this.dispatchBuild(task, options);
    }
  }

  /**
   * Runs a `.studio` run configuration: compiles it to a command and launches it through the same
   * pipeline as a task, so its output streams and its problems are matched.
   *
   * A **compound** launches each of its members as its own run, in parallel, so every member stays
   * individually visible and stoppable — which is why the workspace's other configurations come in as
   * `siblings`: they are what a compound's member ids resolve against. A member that names nothing, and
   * a configuration that cannot be compiled to a command, are skipped rather than failing the rest.
   * @param configuration The run configuration to run.
   * @param siblings Every configuration in the workspace, used to resolve a compound's members.
   */
  public runConfiguration(
    configuration: RunConfiguration,
    siblings: readonly RunConfiguration[] = [],
    options?: BuildActionOptions,
  ): void {
    for (const leaf of expandRunConfiguration(configuration, siblings)) {
      const task: BuildTask | null = this.toTask(leaf);
      if (task !== null) {
        this.dispatchRun(task, options);
      } else {
        // Never a silent no-op: the failure surfaces in the leaf's own run session (exactly where
        // the user is looking), named after it, with the reason on stderr.
        this.announceUnrunnable(leaf);
      }
    }
  }

  /**
   * Executes a run task in its configuration's reused interactive run session: a real PTY the
   * program's stdin is wired to, revealed as it starts, one session per configuration so parallel
   * configurations stay separate and a relaunch replaces the same tab (fresh PTY, fresh buffer). One
   * launch per configuration runs at a time — a busy session leaves the request ignored unless the
   * caller passed `restart` (granted by the ribbon's stop-and-restart prompt).
   * @param task The run task to execute.
   * @param options The action options.
   */
  private dispatchRun(task: BuildTask, options?: BuildActionOptions): void {
    const sessionId: string = this.runSessionId(task.id);
    if (this.currentRuns.has(sessionId) && options?.restart !== true) {
      return;
    }
    const token: symbol = Symbol(task.id);
    this.currentRuns.set(sessionId, token);
    // The session id doubles as the run id: stable per configuration, which is what the Stop menu
    // stops. A relaunch replaces the stale entry rather than adding a second.
    this.runs.update((current: readonly ActiveRun[]): readonly ActiveRun[] => [
      ...current.filter((active: ActiveRun): boolean => active.id !== sessionId),
      { id: sessionId, label: task.label, taskId: task.id, startedAt: Date.now() },
    ]);
    // Only this task's problems are stale; another run's diagnostics stay published.
    this.problemsByTask.delete(task.id);
    this.republishProblems();
    void this.runInSession(task, sessionId, token);
  }

  /**
   * Launches a run task in its session and, once it ends on its own, matches problems from the
   * session's retained scrollback. A superseded launch (relaunched or disposed) publishes nothing and
   * leaves the successor's run entry alone.
   * @param task The task being executed.
   * @param sessionId The configuration's session identifier.
   * @param token The launch token guarding against superseded completions.
   */
  private async runInSession(task: BuildTask, sessionId: string, token: symbol): Promise<void> {
    const launch: TerminalLaunch = await this.sessions.launch({
      sessionId,
      name: `Run: ${task.label}`,
      kind: 'run',
      command: task.command,
      args: task.args,
      env: task.env,
      cwd: task.cwd,
      presentation: task.presentation,
    });
    const exitCode: number = await launch.exited;
    const stoppedByUser: boolean = this.stoppedRuns.delete(sessionId);
    if (this.currentRuns.get(sessionId) !== token) {
      return;
    }
    this.currentRuns.delete(sessionId);
    this.runs.update((current: readonly ActiveRun[]): readonly ActiveRun[] =>
      current.filter((active: ActiveRun): boolean => active.id !== sessionId),
    );
    if (exitCode === DISPOSED_EXIT_CODE) {
      return;
    }
    if (!stoppedByUser) {
      this.notifyRunOutcome(task, sessionId, exitCode);
    }
    const replay: { data: string } = await this.terminalBridge.replay(sessionId);
    this.publishProblems(task, replay.data);
  }

  /**
   * Raises a toast for a finished run — the run ended on its own (a stopped or superseded run stays
   * silent: ending it was the user's own action). A failure's toast opens the run's terminal, where
   * the output that explains it lives.
   * @param task The task that ran.
   * @param sessionId The run's session identifier.
   * @param exitCode The run's exit code.
   */
  private notifyRunOutcome(task: BuildTask, sessionId: string, exitCode: number): void {
    if (exitCode === 0) {
      this.notifications.notify({
        severity: 'success',
        title: `Run finished — ${task.label}`,
        key: `run:${sessionId}`,
      });
      return;
    }
    this.notifications.notify({
      severity: 'error',
      title: `Run failed — ${task.label}`,
      detail: `Exited with code ${exitCode}.`,
      actions: [
        { label: 'Show terminal', run: (): void => this.sessions.activateAndReveal(sessionId) },
      ],
      key: `run:${sessionId}`,
    });
  }

  /**
   * Surfaces an unrunnable configuration in its own run session: the session opens (named after the
   * configuration), prints why nothing could launch, and exits — a visible failure in the place the
   * output would have appeared, never a silent skip. The message travels as an argument-vector
   * element, so nothing in it is shell-interpreted.
   * @param configuration The configuration that produced no runnable command.
   */
  private announceUnrunnable(configuration: RunConfiguration): void {
    const message: string =
      `Run configuration '${configuration.name}' does not produce a runnable command. ` +
      `Set a program (with its arguments), or point its target at a real project, script, or crate.`;
    void this.sessions.launch({
      sessionId: this.runSessionId(configuration.id),
      name: `Run: ${configuration.name}`,
      kind: 'run',
      command: '/bin/sh',
      args: ['-c', 'printf \'%s\\n\' "$1" >&2; exit 1', 'sh', message],
      cwd: this.workspace.root()?.path,
    });
  }

  /**
   * Derives the reused run session identifier for a configuration or run task.
   * @param taskId The configuration or task identifier.
   * @returns Returns the session identifier.
   */
  private runSessionId(taskId: string): string {
    return `${this.runSessionPrefix}:${taskId}`;
  }

  /**
   * Runs a capability action (Build/Clean/Rebuild…) by compiling it to a command for the workspace's
   * ecosystem and launching it. The action is run directly rather than added to the discovered tasks,
   * so it never appears in the Run dropdown. Does nothing when no folder is open or the action cannot
   * be compiled for the ecosystem.
   * @param action The action to run.
   */
  public runAction(action: ProjectAction, options?: BuildActionOptions): void {
    const root: DirectoryListing | null = this.workspace.root();
    if (root === null) {
      return;
    }
    const command: string | null = this.commandForAction(action, root);
    if (command === null) {
      return;
    }
    this.dispatchBuild(
      { id: `action:${action}`, label: command, group: 'other', command, cwd: root.path },
      options,
    );
  }

  /**
   * Executes a build-flavoured task in the workspace's reused Build terminal session: a read-only
   * PTY, revealed as it starts, interruptible with Ctrl+C. One build runs at a time — a busy Build
   * terminal leaves the request ignored unless the caller passed `restart` (granted by the ribbon's
   * stop-and-restart prompt, so a running build is never killed silently). The task's previous
   * problems are cleared up front and re-matched from the session's scrollback when it exits.
   * @param task The build-flavoured task to execute.
   * @param options The action options.
   */
  private dispatchBuild(task: BuildTask, options?: BuildActionOptions): void {
    if (this.buildBusyState() && options?.restart !== true) {
      return;
    }
    const token: symbol = Symbol(task.id);
    this.currentBuild = token;
    this.buildBusyState.set(true);
    // Only this task's problems are stale; another task's diagnostics stay published.
    this.problemsByTask.delete(task.id);
    this.republishProblems();
    void this.runBuildSession(task, token);
  }

  /**
   * Launches a build task in the Build session and, once it exits on its own, matches problems from
   * the session's retained scrollback. A superseded launch (relaunched or disposed) publishes
   * nothing — the successor's results are the current truth.
   * @param task The task being executed.
   * @param token The launch token guarding against superseded completions.
   */
  private async runBuildSession(task: BuildTask, token: symbol): Promise<void> {
    const launch: TerminalLaunch = await this.sessions.launch({
      sessionId: this.buildSessionId,
      name: 'Build',
      kind: 'task',
      command: task.command,
      cwd: task.cwd,
    });
    const exitCode: number = await launch.exited;
    if (this.currentBuild !== token) {
      return;
    }
    this.currentBuild = null;
    this.buildBusyState.set(false);
    if (exitCode === DISPOSED_EXIT_CODE) {
      return;
    }
    this.notifyBuildOutcome(task, exitCode);
    const replay: { data: string } = await this.terminalBridge.replay(this.buildSessionId);
    this.publishProblems(task, replay.data);
  }

  /**
   * Raises a toast for a finished build-flavoured task (a stopped or superseded one stays silent). A
   * failure's toast opens the Build terminal; the Error List carries the matched problems either way.
   * @param task The task that ran.
   * @param exitCode The task's exit code.
   */
  private notifyBuildOutcome(task: BuildTask, exitCode: number): void {
    if (exitCode === 0) {
      this.notifications.notify({
        severity: 'success',
        title: 'Build succeeded',
        detail: task.label,
        key: `build:${this.buildSessionId}`,
      });
      return;
    }
    this.notifications.notify({
      severity: 'error',
      title: 'Build failed',
      detail: `${task.label} exited with code ${exitCode}.`,
      actions: [
        {
          label: 'Show terminal',
          run: (): void => this.sessions.activateAndReveal(this.buildSessionId),
        },
      ],
      key: `build:${this.buildSessionId}`,
    });
  }

  /**
   * Compiles a capability action into a shell command for the workspace's ecosystem, or null when the
   * ecosystem has no command for it. .NET, and the JVM (Gradle or Maven), are compiled here; other
   * ecosystems gain their action commands with their project-system providers.
   * @param action The action.
   * @param root The workspace root listing.
   * @returns Returns the command, or null.
   */
  private commandForAction(action: ProjectAction, root: DirectoryListing): string | null {
    if (this.hasDotnetProject(root)) {
      return this.dotnetAction(action);
    }
    if (this.hasGradleProject(root)) {
      return this.gradleAction(action, this.gradleCommand(root));
    }
    if (this.hasMavenProject(root)) {
      return this.mavenAction(action, this.mavenCommand(root));
    }
    if (this.hasCmakeProject(root)) {
      return this.cmakeAction(action);
    }
    if (this.hasMakeProject(root)) {
      return this.makeAction(action);
    }
    if (this.hasCargoProject(root)) {
      return this.cargoAction(action);
    }
    if (this.hasGoProject(root)) {
      return this.goAction(action);
    }
    return null;
  }

  /**
   * Compiles a capability action into a `dotnet` command, or null when .NET has none for it.
   * @param action The action.
   * @returns Returns the command, or null.
   */
  private dotnetAction(action: ProjectAction): string | null {
    switch (action) {
      case 'build':
        return 'dotnet build';
      case 'clean':
        return 'dotnet clean';
      case 'rebuild':
        return 'dotnet build --no-incremental';
      case 'test':
        return 'dotnet test';
      case 'publish':
        return 'dotnet publish';
      case 'restore':
        return 'dotnet restore';
    }
  }

  /**
   * Compiles a capability action into a Gradle command, or null when Gradle has none for it. Gradle
   * declares only Build/Clean/Test (see the JVM project system's capabilities).
   * @param action The action.
   * @param gradle The Gradle invocation (the wrapper when present, else `gradle`).
   * @returns Returns the command, or null.
   */
  private gradleAction(action: ProjectAction, gradle: string): string | null {
    switch (action) {
      case 'build':
        return `${gradle} build`;
      case 'clean':
        return `${gradle} clean`;
      case 'test':
        return `${gradle} test`;
      default:
        return null;
    }
  }

  /**
   * Compiles a capability action into a Maven command, or null when Maven has none for it. Maven
   * declares only Build/Clean/Test (see the JVM project system's capabilities).
   * @param action The action.
   * @param mvn The Maven invocation (the wrapper when present, else `mvn`).
   * @returns Returns the command, or null.
   */
  private mavenAction(action: ProjectAction, mvn: string): string | null {
    switch (action) {
      case 'build':
        return `${mvn} package`;
      case 'clean':
        return `${mvn} clean`;
      case 'test':
        return `${mvn} test`;
      default:
        return null;
    }
  }

  /**
   * Compiles a capability action into a CMake command, or null when CMake has none for it. The build
   * configures into a `build/` directory first (idempotent), so Build works from a fresh checkout;
   * Clean and Rebuild act on that configured tree. CMake declares Build/Clean/Rebuild (see the C/C++
   * project system's capabilities).
   * @param action The action.
   * @returns Returns the command, or null.
   */
  private cmakeAction(action: ProjectAction): string | null {
    switch (action) {
      case 'build':
        return 'cmake -S . -B build && cmake --build build';
      case 'clean':
        return 'cmake --build build --target clean';
      case 'rebuild':
        return 'cmake -S . -B build && cmake --build build --clean-first';
      default:
        return null;
    }
  }

  /**
   * Compiles a capability action into a Make command, or null when Make has none for it.
   * @param action The action.
   * @returns Returns the command, or null.
   */
  private makeAction(action: ProjectAction): string | null {
    switch (action) {
      case 'build':
        return 'make';
      case 'clean':
        return 'make clean';
      case 'rebuild':
        return 'make clean && make';
      default:
        return null;
    }
  }

  /**
   * Compiles a capability action into a Cargo command, or null when Cargo has none for it. Cargo
   * declares Build/Clean/Rebuild (see the Rust project system's capabilities).
   * @param action The action.
   * @returns Returns the command, or null.
   */
  private cargoAction(action: ProjectAction): string | null {
    switch (action) {
      case 'build':
        return 'cargo build';
      case 'clean':
        return 'cargo clean';
      case 'rebuild':
        return 'cargo clean && cargo build';
      default:
        return null;
    }
  }

  /**
   * Compiles a capability action into a Go command, or null when Go has none for it. Go declares
   * Build/Clean/Rebuild (see the Go project system's capabilities); rebuild forces a full recompile
   * with `-a`.
   * @param action The action.
   * @returns Returns the command, or null.
   */
  private goAction(action: ProjectAction): string | null {
    switch (action) {
      case 'build':
        return 'go build ./...';
      case 'clean':
        return 'go clean';
      case 'rebuild':
        return 'go build -a ./...';
      default:
        return null;
    }
  }

  /**
   * Determines whether the workspace root holds a .NET solution or project file.
   * @param root The workspace root listing.
   * @returns Returns true when a .NET project is present.
   */
  private hasDotnetProject(root: DirectoryListing): boolean {
    return root.entries.some(
      (entry: DirectoryEntry): boolean =>
        entry.type === 'file' && DOTNET_PROJECT_PATTERN.test(entry.name),
    );
  }

  /**
   * Determines whether the workspace root holds a Gradle build (a build or settings script).
   * @param root The workspace root listing.
   * @returns Returns true when a Gradle script is present.
   */
  private hasGradleProject(root: DirectoryListing): boolean {
    return root.entries.some(
      (entry: DirectoryEntry): boolean =>
        entry.type === 'file' && GRADLE_SCRIPT_PATTERN.test(entry.name),
    );
  }

  /**
   * Determines whether the workspace root holds a Maven project (a `pom.xml`).
   * @param root The workspace root listing.
   * @returns Returns true when a pom is present.
   */
  private hasMavenProject(root: DirectoryListing): boolean {
    return root.entries.some(
      (entry: DirectoryEntry): boolean => entry.type === 'file' && entry.name === 'pom.xml',
    );
  }

  /**
   * Determines whether the workspace root holds a CMake project (a `CMakeLists.txt`).
   * @param root The workspace root listing.
   * @returns Returns true when a `CMakeLists.txt` is present.
   */
  private hasCmakeProject(root: DirectoryListing): boolean {
    return this.hasEntry(root, 'CMakeLists.txt');
  }

  /**
   * Determines whether the workspace root holds a Make project (a GNU or POSIX makefile).
   * @param root The workspace root listing.
   * @returns Returns true when a makefile is present.
   */
  private hasMakeProject(root: DirectoryListing): boolean {
    return root.entries.some(
      (entry: DirectoryEntry): boolean =>
        entry.type === 'file' && /^(GNUmakefile|[Mm]akefile)$/.test(entry.name),
    );
  }

  /**
   * Determines whether the workspace root holds a Cargo project (a `Cargo.toml`).
   * @param root The workspace root listing.
   * @returns Returns true when a Cargo manifest is present.
   */
  private hasCargoProject(root: DirectoryListing): boolean {
    return this.hasEntry(root, 'Cargo.toml');
  }

  /**
   * Determines whether the workspace root holds a Go module (a `go.mod`).
   * @param root The workspace root listing.
   * @returns Returns true when a Go module manifest is present.
   */
  private hasGoProject(root: DirectoryListing): boolean {
    return this.hasEntry(root, 'go.mod');
  }

  /**
   * Resolves the Gradle invocation for a root, preferring the checked-in wrapper over a system Gradle.
   * @param root The workspace root listing.
   * @returns Returns `./gradlew` when the wrapper is present, else `gradle`.
   */
  private gradleCommand(root: DirectoryListing): string {
    return this.hasEntry(root, 'gradlew') ? './gradlew' : 'gradle';
  }

  /**
   * Resolves the Maven invocation for a root, preferring the checked-in wrapper over a system Maven.
   * @param root The workspace root listing.
   * @returns Returns `./mvnw` when the wrapper is present, else `mvn`.
   */
  private mavenCommand(root: DirectoryListing): string {
    return this.hasEntry(root, 'mvnw') ? './mvnw' : 'mvn';
  }

  /**
   * Determines whether the workspace root holds a file with the given name.
   * @param root The workspace root listing.
   * @param name The file name.
   * @returns Returns true when the file is present.
   */
  private hasEntry(root: DirectoryListing, name: string): boolean {
    return root.entries.some(
      (entry: DirectoryEntry): boolean => entry.type === 'file' && entry.name === name,
    );
  }

  /**
   * Compiles a run configuration into a runnable task, or null when it names neither a program nor a
   * kind this runner knows how to launch. An explicit program wins — spawned directly with its
   * argument vector when one is given (no shell quoting to get wrong) — otherwise the command derives
   * from the provider kind against the configuration's target (falling back to its id). The
   * configuration's environment and working directory (resolved against the workspace root when
   * relative) ride along; build-configuration and target-axis selection remain a later phase.
   * @param configuration The run configuration to compile.
   * @returns Returns the task, or null when it cannot be compiled.
   */
  private toTask(configuration: RunConfiguration): BuildTask | null {
    const root: string | undefined = this.workspace.root()?.path;
    const raw: string | undefined = configuration.cwd;
    const cwd: string =
      raw !== undefined && raw.length > 0
        ? isAbsolute(raw) || root === undefined
          ? raw
          : resolvePath(root, raw)
        : (root ?? '');
    const compiled: { command: string; args?: readonly string[] } | null =
      this.compileRun(configuration);
    if (compiled === null) {
      return null;
    }
    return {
      id: configuration.id,
      label: configuration.name,
      group: 'run',
      command: compiled.command,
      args: compiled.args,
      env: configuration.env,
      cwd,
      presentation: configuration.presentation,
    };
  }

  /**
   * Derives what a run configuration launches: an explicit program (direct-spawned with its argument
   * vector when one is given), or a provider-kind default against the configuration's target — a .NET
   * project resolved through the workspace's project model when it is available, an npm script, a
   * cargo crate — or null for an unknown provider with no program.
   * @param configuration The run configuration.
   * @returns Returns the command (with an optional argument vector), or null when none derives.
   */
  private compileRun(
    configuration: RunConfiguration,
  ): { command: string; args?: readonly string[] } | null {
    if (configuration.program !== undefined) {
      return configuration.args !== undefined && configuration.args.length > 0
        ? { command: configuration.program, args: configuration.args }
        : { command: configuration.program };
    }
    const target: string = configuration.target ?? configuration.id;
    if (configuration.providerKind === 'dotnet') {
      return { command: `dotnet run --project "${this.resolveDotnetProject(target)}"` };
    }
    if (configuration.providerKind === 'node') {
      return { command: `npm run ${target}` };
    }
    if (configuration.providerKind === 'jvm') {
      const command: string | null = this.jvmRunCommand();
      return command === null ? null : { command };
    }
    if (configuration.providerKind === 'cpp') {
      // Build the selected CMake executable target, then run the produced binary. A single-config
      // generator places it at `build/<target>`.
      return { command: `cmake --build build --target ${target} && ./build/${target}` };
    }
    if (configuration.providerKind === 'rust') {
      // The target is the crate name; `-p` selects it in both a single crate and a workspace.
      return { command: `cargo run -p ${target}` };
    }
    if (configuration.providerKind === 'go') {
      return { command: 'go run .' };
    }
    return null;
  }

  /**
   * Resolves a .NET run target to a real project file path through the workspace's project model,
   * matching by project name (or project file path tail). Absent a model or a match, the literal
   * target is returned — `dotnet run --project` accepts a path, so a correct explicit value still
   * works.
   * @param target The configured target (or the configuration id standing in for it).
   * @returns Returns the project file path, or the literal target.
   */
  private resolveDotnetProject(target: string): string {
    const model: ProjectModel | null = this.projectModel?.() ?? null;
    if (model?.kind !== 'dotnet') {
      return target;
    }
    const lowered: string = target.toLowerCase();
    const match: ProjectEntry | undefined = model.projects.find(
      (project: ProjectEntry): boolean =>
        project.name.toLowerCase() === lowered || project.path.toLowerCase().endsWith(lowered),
    );
    return match?.path ?? target;
  }

  /**
   * Derives the default JVM run command from the workspace root's build tool: Gradle's `run` (the
   * application plugin's task) or Maven's `exec:java`, preferring each tool's wrapper. Returns null when
   * no folder is open or the root is neither a Gradle nor a Maven build.
   * @returns Returns the run command, or null.
   */
  private jvmRunCommand(): string | null {
    const root: DirectoryListing | null = this.workspace.root();
    if (root === null) {
      return null;
    }
    if (this.hasGradleProject(root)) {
      return `${this.gradleCommand(root)} run`;
    }
    if (this.hasMavenProject(root)) {
      return `${this.mavenCommand(root)} exec:java`;
    }
    return null;
  }

  /**
   * Stops one in-flight run, leaving every other run alone: its session's process tree is terminated
   * (SIGTERM escalating to SIGKILL) while the session tab, its output, and its exit banner remain. A
   * run id that is not (or is no longer) in flight is ignored.
   * @param runId The run to stop (the configuration's session identifier).
   */
  public cancel(runId: string): void {
    if (this.currentRuns.has(runId)) {
      this.stoppedRuns.add(runId);
      this.sessions.terminate(runId);
    }
  }

  /**
   * Stops every in-flight run. The exit events tear each run down, as they do for a single stop.
   */
  public cancelAll(): void {
    for (const runId of [...this.currentRuns.keys()]) {
      this.stoppedRuns.add(runId);
      this.sessions.terminate(runId);
    }
  }

  /**
   * Parses a finished run's output into diagnostics, records them under its task, and republishes the
   * union so a concurrent run's problems are neither lost nor duplicated.
   * @param task The task that produced the output.
   * @param text The accumulated output.
   */
  private publishProblems(task: BuildTask, text: string): void {
    const diagnostics: readonly Diagnostic[] = parseProblems(text).map(
      (problem: MatchedProblem): Diagnostic => this.toDiagnostic(problem, task.cwd),
    );
    this.problemsByTask.set(task.id, diagnostics);
    this.republishProblems();
  }

  /**
   * Publishes the union of every task's matched problems to the diagnostics aggregate.
   */
  private republishProblems(): void {
    this.setProblems([...this.problemsByTask.values()].flat());
  }

  /**
   * Maps a matched problem to a provider-agnostic diagnostic, resolving its file to an open document
   * when possible.
   * @param problem The matched problem.
   * @param root The workspace root, used to resolve relative file paths.
   * @returns Returns the diagnostic.
   */
  private toDiagnostic(problem: MatchedProblem, root: string): Diagnostic {
    const path: string = resolvePath(root, problem.file);
    return {
      file: basename(path),
      message: problem.message,
      severity: problem.severity,
      line: problem.line,
      column: problem.column,
      source: problem.source,
      documentId: this.documents.findIdByPath(path) ?? null,
      path,
      scope: 'workspace',
    };
  }

  /**
   * Replaces the published build problems and notifies the diagnostics aggregate.
   * @param diagnostics The new problem set.
   */
  private setProblems(diagnostics: readonly Diagnostic[]): void {
    this.problems = diagnostics;
    this.emit?.(diagnostics);
  }

  /**
   * Discovers the workspace's build/run/test tasks from its ecosystem.
   * @param root The workspace root listing, or null when no folder is open.
   */
  private async discover(root: DirectoryListing | null): Promise<void> {
    if (root === null) {
      this.discovered.set([]);
      return;
    }
    const tasks: BuildTask[] = [
      ...this.discoverDotnet(root),
      ...this.discoverGradle(root),
      ...this.discoverMaven(root),
      ...this.discoverCmake(root),
      ...this.discoverMake(root),
      ...this.discoverCargo(root),
      ...this.discoverGo(root),
      ...(await this.discoverNpm(root)),
    ];
    this.discovered.set(tasks);
  }

  /**
   * Discovers Gradle tasks when a Gradle build file is present, preferring the wrapper when it exists.
   * @param root The workspace root listing.
   * @returns Returns the Gradle tasks, or an empty list.
   */
  private discoverGradle(root: DirectoryListing): BuildTask[] {
    if (!this.hasGradleProject(root)) {
      return [];
    }
    const gradle: string = this.gradleCommand(root);
    return [
      {
        id: 'gradle:build',
        label: `${gradle} build`,
        group: 'build',
        command: `${gradle} build`,
        cwd: root.path,
      },
      {
        id: 'gradle:test',
        label: `${gradle} test`,
        group: 'test',
        command: `${gradle} test`,
        cwd: root.path,
      },
    ];
  }

  /**
   * Discovers Maven tasks when a `pom.xml` is present, preferring the wrapper when it exists.
   * @param root The workspace root listing.
   * @returns Returns the Maven tasks, or an empty list.
   */
  private discoverMaven(root: DirectoryListing): BuildTask[] {
    if (!this.hasMavenProject(root)) {
      return [];
    }
    const mvn: string = this.mavenCommand(root);
    return [
      {
        id: 'maven:build',
        label: `${mvn} package`,
        group: 'build',
        command: `${mvn} package`,
        cwd: root.path,
      },
      {
        id: 'maven:test',
        label: `${mvn} test`,
        group: 'test',
        command: `${mvn} test`,
        cwd: root.path,
      },
    ];
  }

  /**
   * Discovers a CMake build task when a `CMakeLists.txt` is present in the root. The task configures a
   * `build/` directory (idempotent) then builds it, so the ribbon's Build button works from a fresh
   * checkout.
   * @param root The workspace root listing.
   * @returns Returns the CMake task, or an empty list.
   */
  private discoverCmake(root: DirectoryListing): BuildTask[] {
    if (!this.hasCmakeProject(root)) {
      return [];
    }
    return [
      {
        id: 'cmake:build',
        label: 'cmake --build build',
        group: 'build',
        command: 'cmake -S . -B build && cmake --build build',
        cwd: root.path,
      },
    ];
  }

  /**
   * Discovers a Make task when a makefile is present in the root.
   * @param root The workspace root listing.
   * @returns Returns the Make task, or an empty list.
   */
  private discoverMake(root: DirectoryListing): BuildTask[] {
    const hasMakefile: boolean = root.entries.some(
      (entry: DirectoryEntry): boolean =>
        entry.type === 'file' && /^(GNUmakefile|[Mm]akefile)$/.test(entry.name),
    );
    if (!hasMakefile) {
      return [];
    }
    return [{ id: 'make:build', label: 'make', group: 'build', command: 'make', cwd: root.path }];
  }

  /**
   * Discovers Cargo tasks when a `Cargo.toml` is present in the root.
   * @param root The workspace root listing.
   * @returns Returns the Cargo tasks, or an empty list.
   */
  private discoverCargo(root: DirectoryListing): BuildTask[] {
    if (!this.hasCargoProject(root)) {
      return [];
    }
    return [
      {
        id: 'cargo:build',
        label: 'cargo build',
        group: 'build',
        command: 'cargo build',
        cwd: root.path,
      },
      {
        id: 'cargo:test',
        label: 'cargo test',
        group: 'test',
        command: 'cargo test',
        cwd: root.path,
      },
      { id: 'cargo:run', label: 'cargo run', group: 'run', command: 'cargo run', cwd: root.path },
    ];
  }

  /**
   * Discovers Go tasks when a `go.mod` is present in the root.
   * @param root The workspace root listing.
   * @returns Returns the Go tasks, or an empty list.
   */
  private discoverGo(root: DirectoryListing): BuildTask[] {
    if (!this.hasGoProject(root)) {
      return [];
    }
    return [
      {
        id: 'go:build',
        label: 'go build ./...',
        group: 'build',
        command: 'go build ./...',
        cwd: root.path,
      },
      {
        id: 'go:test',
        label: 'go test ./...',
        group: 'test',
        command: 'go test ./...',
        cwd: root.path,
      },
      { id: 'go:run', label: 'go run .', group: 'run', command: 'go run .', cwd: root.path },
    ];
  }

  /**
   * Discovers .NET tasks when a solution or project file is present in the root.
   * @param root The workspace root listing.
   * @returns Returns the .NET tasks, or an empty list.
   */
  private discoverDotnet(root: DirectoryListing): BuildTask[] {
    if (!this.hasDotnetProject(root)) {
      return [];
    }
    return [
      {
        id: 'dotnet:build',
        label: 'dotnet build',
        group: 'build',
        command: 'dotnet build',
        cwd: root.path,
      },
      {
        id: 'dotnet:test',
        label: 'dotnet test',
        group: 'test',
        command: 'dotnet test',
        cwd: root.path,
      },
      {
        id: 'dotnet:run',
        label: 'dotnet run',
        group: 'run',
        command: 'dotnet run',
        cwd: root.path,
      },
    ];
  }

  /**
   * Discovers npm tasks from the root's `package.json` scripts.
   * @param root The workspace root listing.
   * @returns Returns the npm tasks, or an empty list.
   */
  private async discoverNpm(root: DirectoryListing): Promise<BuildTask[]> {
    const entry: DirectoryEntry | undefined = root.entries.find(
      (candidate: DirectoryEntry): boolean =>
        candidate.type === 'file' && candidate.name === 'package.json',
    );
    if (entry === undefined) {
      return [];
    }
    const selection: OpenSelection | null = await this.workspace.readFile(entry.path);
    if (selection?.kind !== 'file') {
      return [];
    }
    return this.parseScripts(selection.file.content).map(
      (name: string): BuildTask => ({
        id: `npm:${name}`,
        label: `npm run ${name}`,
        group: groupOf(name),
        command: `npm run ${name}`,
        cwd: root.path,
      }),
    );
  }

  /**
   * Parses the script names from a `package.json`'s contents, ignoring malformed JSON.
   * @param content The file contents.
   * @returns Returns the script names, or an empty list.
   */
  private parseScripts(content: string): string[] {
    try {
      const parsed: { scripts?: Record<string, unknown> } = JSON.parse(content) as {
        scripts?: Record<string, unknown>;
      };
      const scripts: Record<string, unknown> = parsed.scripts ?? {};
      return Object.keys(scripts);
    } catch {
      return [];
    }
  }
}
