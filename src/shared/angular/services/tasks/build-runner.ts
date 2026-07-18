import { effect, inject, OnDestroy, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { DirectoryEntry, DirectoryListing, OpenSelection } from '@shared/api/workspace-channels';
import { ProjectAction } from '@shared/api/project-system';
import { RunConfiguration } from '@shared/api/studio';
import { TaskChannel } from '@shared/api/task-channels';
import {
  Diagnostic,
  Diagnostics,
  DiagnosticsProvider,
} from '@shared/angular/services/diagnostics/diagnostics';
import { Documents } from '@shared/angular/services/documents/documents';
import { Output } from '../output/output';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { BuildGroup, BuildHandler, BuildTask } from './builds';
import { MatchedProblem, parseProblems } from './problem-matcher';

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
 * solution). A run is executed as a captured child process through the main-process task runner; its
 * output streams into the Output channel and, on completion, is parsed by the problem matchers into
 * diagnostics published under this workspace's aggregate. It implements {@link BuildHandler} so the
 * root ribbon can drive whichever workspace is active.
 */
@Service()
export class BuildRunner implements BuildHandler, OnDestroy {
  /**
   * Holds this workspace's Output channel.
   */
  private readonly output: Output = inject(Output);

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
   * Holds the generic transport, or undefined outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the discovered tasks.
   */
  private readonly discovered: WritableSignal<readonly BuildTask[]> = signal<readonly BuildTask[]>(
    [],
  );

  /**
   * Holds whether a task is currently running.
   */
  private readonly isRunning: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the discovered tasks.
   */
  public readonly tasks: Signal<readonly BuildTask[]> = this.discovered.asReadonly();

  /**
   * Gets whether a task is currently running.
   */
  public readonly running: Signal<boolean> = this.isRunning.asReadonly();

  /**
   * Holds the identifier of the in-flight run, or null when nothing is running.
   */
  private activeRunId: string | null = null;

  /**
   * Holds the task backing the in-flight run, or null when nothing is running.
   */
  private activeTask: BuildTask | null = null;

  /**
   * Accumulates the in-flight run's output for problem matching.
   */
  private buffer: string = '';

  /**
   * Holds the current build problems published to the diagnostics aggregate.
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
   * Holds the function that removes the task-output listener, or null when not subscribed.
   */
  private readonly cleanupOutput: (() => void) | null;

  /**
   * Holds the function that removes the task-exit listener, or null when not subscribed.
   */
  private readonly cleanupExit: (() => void) | null;

  /**
   * Initializes the runner: registers its diagnostics provider, subscribes to task output and exit,
   * and re-discovers tasks whenever the workspace root changes.
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
    this.cleanupOutput =
      this.bridge?.on(TaskChannel.Output, (...args: unknown[]): void =>
        this.onOutput(args[0] as string, args[1] as string),
      ) ?? null;
    this.cleanupExit =
      this.bridge?.on(TaskChannel.Exit, (...args: unknown[]): void =>
        this.onExit(args[0] as string, args[1] as number | null, args[2] as string | null),
      ) ?? null;

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
   * Tears down the diagnostics provider and task listeners, cancelling any in-flight run.
   */
  public ngOnDestroy(): void {
    this.cancel();
    this.cleanupOutput?.();
    this.cleanupExit?.();
    this.unregisterProvider();
  }

  /**
   * Runs the task with the given identifier, streaming its output and publishing its problems. Does
   * nothing when the task is unknown, a run is already in flight, or Electron is unavailable.
   * @param taskId The task to run.
   */
  public run(taskId: string): void {
    const task: BuildTask | undefined = this.discovered().find(
      (candidate: BuildTask): boolean => candidate.id === taskId,
    );
    if (task !== undefined) {
      this.launch(task);
    }
  }

  /**
   * Runs a `.studio` run configuration: compiles it to a command and launches it through the same
   * pipeline as a task, so its output streams and its problems are matched. Does nothing when the
   * configuration cannot be compiled to a command.
   * @param configuration The run configuration to run.
   */
  public runConfiguration(configuration: RunConfiguration): void {
    const task: BuildTask | null = this.toTask(configuration);
    if (task !== null) {
      this.launch(task);
    }
  }

  /**
   * Runs a capability action (Build/Clean/Rebuild…) by compiling it to a command for the workspace's
   * ecosystem and launching it. The action is run directly rather than added to the discovered tasks,
   * so it never appears in the Run dropdown. Does nothing when no folder is open or the action cannot
   * be compiled for the ecosystem.
   * @param action The action to run.
   */
  public runAction(action: ProjectAction): void {
    const root: DirectoryListing | null = this.workspace.root();
    if (root === null) {
      return;
    }
    const command: string | null = this.commandForAction(action, root);
    if (command === null) {
      return;
    }
    this.launch({ id: `action:${action}`, label: command, group: 'other', command, cwd: root.path });
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
   * Launches a task as a captured child process, streaming its output and clearing prior problems.
   * Does nothing when a run is already in flight or Electron is unavailable.
   * @param task The task to launch.
   */
  private launch(task: BuildTask): void {
    if (this.bridge === undefined || this.activeRunId !== null) {
      return;
    }
    const runId: string = crypto.randomUUID();
    this.activeRunId = runId;
    this.activeTask = task;
    this.buffer = '';
    this.isRunning.set(true);
    this.setProblems([]);
    this.output.appendLine(`> ${task.label}`);
    void this.bridge.invoke(TaskChannel.Run, { runId, command: task.command, cwd: task.cwd });
  }

  /**
   * Compiles a run configuration into a runnable task, or null when it names neither a program nor a
   * kind this runner knows how to launch. An explicit program (with its arguments) wins; otherwise the
   * command is derived from the provider kind — a .NET project run or an npm script. Build-configuration
   * and target selection, and environment variables, are layered on by later phases.
   * @param configuration The run configuration to compile.
   * @returns Returns the task, or null when it cannot be compiled.
   */
  private toTask(configuration: RunConfiguration): BuildTask | null {
    const cwd: string = configuration.cwd ?? this.workspace.root()?.path ?? '';
    const command: string | null = this.commandFor(configuration);
    if (command === null) {
      return null;
    }
    return { id: configuration.id, label: configuration.name, group: 'run', command, cwd };
  }

  /**
   * Derives the shell command a run configuration launches: an explicit program and its arguments when
   * set, otherwise a provider-kind default (`dotnet run --project <id>` or `npm run <id>`), or null for
   * an unknown provider with no program.
   * @param configuration The run configuration.
   * @returns Returns the command line, or null when none can be derived.
   */
  private commandFor(configuration: RunConfiguration): string | null {
    if (configuration.program !== undefined) {
      const args: string = configuration.args?.join(' ') ?? '';
      return args.length > 0 ? `${configuration.program} ${args}` : configuration.program;
    }
    if (configuration.providerKind === 'dotnet') {
      return `dotnet run --project ${configuration.id}`;
    }
    if (configuration.providerKind === 'node') {
      return `npm run ${configuration.id}`;
    }
    if (configuration.providerKind === 'jvm') {
      return this.jvmRunCommand();
    }
    if (configuration.providerKind === 'cpp') {
      // Build the selected CMake executable target, then run the produced binary. A single-config
      // generator places it at `build/<target>`; the id is the target name.
      return `cmake --build build --target ${configuration.id} && ./build/${configuration.id}`;
    }
    if (configuration.providerKind === 'rust') {
      // The id is the crate name; `-p` selects it in both a single crate and a workspace.
      return `cargo run -p ${configuration.id}`;
    }
    if (configuration.providerKind === 'go') {
      return 'go run .';
    }
    return null;
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
   * Cancels the in-flight run, if any.
   */
  public cancel(): void {
    if (this.activeRunId !== null) {
      void this.bridge?.invoke(TaskChannel.Cancel, this.activeRunId);
    }
  }

  /**
   * Appends a chunk of the in-flight run's output to the Output channel and buffer.
   * @param runId The run the chunk belongs to.
   * @param chunk The output chunk.
   */
  private onOutput(runId: string, chunk: string): void {
    if (runId !== this.activeRunId) {
      return;
    }
    this.buffer += chunk;
    this.output.append(chunk);
  }

  /**
   * Finishes the in-flight run: writes an exit footer and publishes the matched problems.
   * @param runId The run that exited.
   * @param code The exit code, or null when terminated by a signal.
   * @param signal The terminating signal, or null when exited normally.
   */
  private onExit(runId: string, code: number | null, signal: string | null): void {
    if (runId !== this.activeRunId) {
      return;
    }
    const task: BuildTask | null = this.activeTask;
    this.activeRunId = null;
    this.activeTask = null;
    this.isRunning.set(false);
    const status: string =
      signal !== null ? `terminated (${signal})` : `exited with code ${code ?? 0}`;
    this.output.appendLine(`> ${task?.label ?? 'Task'} ${status}`);
    if (task !== null) {
      this.publishProblems(this.buffer, task.cwd);
    }
  }

  /**
   * Parses the run's output into diagnostics and publishes them.
   * @param text The accumulated output.
   * @param root The workspace root, used to resolve relative file paths.
   */
  private publishProblems(text: string, root: string): void {
    const diagnostics: Diagnostic[] = parseProblems(text).map(
      (problem: MatchedProblem): Diagnostic => this.toDiagnostic(problem, root),
    );
    this.setProblems(diagnostics);
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
      { id: 'cargo:build', label: 'cargo build', group: 'build', command: 'cargo build', cwd: root.path },
      { id: 'cargo:test', label: 'cargo test', group: 'test', command: 'cargo test', cwd: root.path },
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
      { id: 'go:test', label: 'go test ./...', group: 'test', command: 'go test ./...', cwd: root.path },
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
