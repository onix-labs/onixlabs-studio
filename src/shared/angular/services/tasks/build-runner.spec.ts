import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { OpenSelection, WorkspaceChannel } from '@shared/api/workspace-channels';
import { TaskChannel, TaskRunRequest } from '@shared/api/task-channels';
import { RunConfiguration } from '@shared/api/studio';
import {
  Diagnostic,
  Diagnostics,
  DiagnosticsProvider,
} from '@shared/angular/services/diagnostics/diagnostics';
import { Documents } from '@shared/angular/services/documents/documents';
import { Output } from '../output/output';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { BuildRunner } from './build-runner';
import { BuildTask } from './builds';

/**
 * A controllable fake transport: routes the task-runner channels (recording runs and capturing the
 * output/exit listeners so tests can emit them) and the workspace open-file channel used to read a
 * discovered `package.json`.
 */
class FakeTaskBridge implements Bridge {
  public readonly runCalls: TaskRunRequest[] = [];
  private outputListener: ((...args: unknown[]) => void) | null = null;
  private exitListener: ((...args: unknown[]) => void) | null = null;

  public invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    if (channel === (TaskChannel.Run as string)) {
      this.runCalls.push(args[0] as TaskRunRequest);
      return Promise.resolve({ success: true, pid: 1 } as T);
    }
    if (channel === (TaskChannel.Cancel as string)) {
      return Promise.resolve(true as T);
    }
    if (channel === (WorkspaceChannel.OpenFile as string)) {
      const path: string = args[0] as string;
      const selection: OpenSelection | null = path.endsWith('package.json')
        ? {
            kind: 'file',
            file: { path, name: 'package.json', extension: '.json', content: PACKAGE_JSON },
          }
        : null;
      return Promise.resolve(selection as T);
    }
    return Promise.resolve(null as T);
  }

  public send(): void {
    return undefined;
  }

  public on(channel: string, listener: (...args: unknown[]) => void): () => void {
    if (channel === (TaskChannel.Output as string)) {
      this.outputListener = listener;
      return (): void => {
        this.outputListener = null;
      };
    }
    if (channel === (TaskChannel.Exit as string)) {
      this.exitListener = listener;
      return (): void => {
        this.exitListener = null;
      };
    }
    return (): void => undefined;
  }

  public emitOutput(runId: string, chunk: string): void {
    this.outputListener?.(runId, chunk, 'stdout');
  }

  public emitExit(runId: string, code: number | null): void {
    this.exitListener?.(runId, code, null);
  }
}

/**
 * A fake diagnostics aggregate that captures the build runner's published set.
 */
class FakeDiagnostics {
  public published: readonly Diagnostic[] = [];

  public register(provider: DiagnosticsProvider): () => void {
    return provider.connect((diagnostics: readonly Diagnostic[]): void => {
      this.published = diagnostics;
    });
  }
}

const PACKAGE_JSON: string = JSON.stringify({ scripts: { build: 'tsc', test: 'vitest' } });

describe('BuildRunner', () => {
  let api: FakeTaskBridge;
  let diagnostics: FakeDiagnostics;

  beforeEach(() => {
    api = new FakeTaskBridge();
    diagnostics = new FakeDiagnostics();
    (window as unknown as { bridge: Bridge }).bridge = api;
    TestBed.configureTestingModule({
      providers: [
        BuildRunner,
        Workspace,
        Documents,
        Output,
        { provide: Diagnostics, useValue: diagnostics },
      ],
    });
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  /**
   * Opens a workspace root containing a .NET project and a package.json, then discovers its tasks.
   * @returns Returns the build runner after discovery.
   */
  async function discover(): Promise<BuildRunner> {
    const workspace: Workspace = TestBed.inject(Workspace);
    workspace.openListing({
      path: '/w',
      name: 'w',
      entries: [
        { name: 'App.csproj', path: '/w/App.csproj', type: 'file' },
        { name: 'package.json', path: '/w/package.json', type: 'file' },
      ],
    });
    const runner: BuildRunner = TestBed.inject(BuildRunner);
    await runner.refresh();
    return runner;
  }

  it('discover_findsDotnetAndNpmTasks', async () => {
    const runner: BuildRunner = await discover();

    const ids: string[] = runner.tasks().map((task: BuildTask): string => task.id);
    expect(ids).toContain('dotnet:build');
    expect(ids).toContain('dotnet:test');
    expect(ids).toContain('npm:build');
    expect(ids).toContain('npm:test');
  });

  it('discover_findsGradleWrapperAndMakeTasks', async () => {
    const workspace: Workspace = TestBed.inject(Workspace);
    workspace.openListing({
      path: '/g',
      name: 'g',
      entries: [
        { name: 'build.gradle.kts', path: '/g/build.gradle.kts', type: 'file' },
        { name: 'gradlew', path: '/g/gradlew', type: 'file' },
        { name: 'Makefile', path: '/g/Makefile', type: 'file' },
      ],
    });
    const runner: BuildRunner = TestBed.inject(BuildRunner);
    await runner.refresh();

    const tasks: readonly BuildTask[] = runner.tasks();
    const gradle: BuildTask | undefined = tasks.find(
      (t: BuildTask): boolean => t.id === 'gradle:build',
    );
    expect(gradle?.command).toBe('./gradlew build');
    expect(tasks.some((t: BuildTask): boolean => t.id === 'make:build')).toBe(true);
  });

  it('run_streamsOutputAndPublishesMatchedProblems', async () => {
    const runner: BuildRunner = await discover();
    const output: Output = TestBed.inject(Output);

    runner.run('dotnet:build');
    expect(runner.running()).toBe(true);
    const runId: string = api.runCalls[0].runId;
    expect(api.runCalls[0].command).toBe('dotnet build');

    api.emitOutput(runId, 'Program.cs(8,9): error CS1002: ; expected [/w/App.csproj]\n');
    api.emitExit(runId, 1);

    expect(runner.running()).toBe(false);
    expect(output.snapshot()).toContain('> dotnet build');
    expect(output.snapshot()).toContain('error CS1002');

    expect(diagnostics.published).toHaveLength(1);
    expect(diagnostics.published[0]).toMatchObject({
      file: 'Program.cs',
      path: '/w/Program.cs',
      severity: 'error',
      source: 'csharp',
      scope: 'workspace',
      line: 8,
      column: 9,
    });
  });

  it('run_clearsPreviousProblemsWhenStartingAgain', async () => {
    const runner: BuildRunner = await discover();

    runner.run('dotnet:build');
    api.emitOutput(api.runCalls[0].runId, 'Program.cs(8,9): error CS1002: ; expected\n');
    api.emitExit(api.runCalls[0].runId, 1);
    expect(diagnostics.published).toHaveLength(1);

    runner.run('dotnet:build');
    expect(diagnostics.published).toHaveLength(0);
  });

  it('runConfiguration_dotnetProject_runsDotnetRunAgainstTheProject', async () => {
    const runner: BuildRunner = await discover();
    const configuration: RunConfiguration = {
      id: '/w/App.csproj',
      name: 'App',
      providerKind: 'dotnet',
      mode: 'run',
    };

    runner.runConfiguration(configuration);

    expect(api.runCalls[0].command).toBe('dotnet run --project /w/App.csproj');
    expect(api.runCalls[0].cwd).toBe('/w');
  });

  it('runConfiguration_nodeScript_runsNpmRun', async () => {
    const runner: BuildRunner = await discover();

    runner.runConfiguration({ id: 'build', name: 'build', providerKind: 'node', mode: 'run' });

    expect(api.runCalls[0].command).toBe('npm run build');
  });

  it('runConfiguration_explicitProgram_runsTheProgramWithItsArguments', async () => {
    const runner: BuildRunner = await discover();

    runner.runConfiguration({
      id: 'x',
      name: 'X',
      providerKind: 'dotnet',
      program: './run.sh',
      args: ['--fast', '-v'],
      mode: 'run',
    });

    expect(api.runCalls[0].command).toBe('./run.sh --fast -v');
  });

  it('runConfiguration_usesTheConfigurationsWorkingDirectoryWhenSet', async () => {
    const runner: BuildRunner = await discover();

    runner.runConfiguration({
      id: 'build',
      name: 'build',
      providerKind: 'node',
      cwd: '/w/sub',
      mode: 'run',
    });

    expect(api.runCalls[0].cwd).toBe('/w/sub');
  });

  it('runAction_clean_runsDotnetCleanInTheRoot', async () => {
    const runner: BuildRunner = await discover();

    runner.runAction('clean');

    expect(api.runCalls[0].command).toBe('dotnet clean');
    expect(api.runCalls[0].cwd).toBe('/w');
  });

  it('runAction_rebuild_runsANonIncrementalBuild', async () => {
    const runner: BuildRunner = await discover();

    runner.runAction('rebuild');

    expect(api.runCalls[0].command).toBe('dotnet build --no-incremental');
  });

  it('runAction_doesNothingForAnEcosystemWithNoCommand', async () => {
    const workspace: Workspace = TestBed.inject(Workspace);
    workspace.openListing({
      path: '/n',
      name: 'n',
      entries: [{ name: 'package.json', path: '/n/package.json', type: 'file' }],
    });
    const runner: BuildRunner = TestBed.inject(BuildRunner);
    await runner.refresh();

    runner.runAction('clean');

    expect(api.runCalls).toHaveLength(0);
  });

  /**
   * Opens a JVM workspace root and discovers its tasks.
   * @param entries The root's file entries.
   * @returns Returns the build runner after discovery.
   */
  async function discoverJvm(
    entries: { name: string; path: string; type: 'file' }[],
  ): Promise<BuildRunner> {
    const workspace: Workspace = TestBed.inject(Workspace);
    workspace.openListing({ path: '/j', name: 'j', entries });
    const runner: BuildRunner = TestBed.inject(BuildRunner);
    await runner.refresh();
    return runner;
  }

  it('discover_findsMavenWrapperTasks', async () => {
    const runner: BuildRunner = await discoverJvm([
      { name: 'pom.xml', path: '/j/pom.xml', type: 'file' },
      { name: 'mvnw', path: '/j/mvnw', type: 'file' },
    ]);

    const build: BuildTask | undefined = runner
      .tasks()
      .find((t: BuildTask): boolean => t.id === 'maven:build');
    expect(build?.command).toBe('./mvnw package');
    expect(runner.tasks().some((t: BuildTask): boolean => t.id === 'maven:test')).toBe(true);
  });

  it('runAction_build_runsGradleBuildInTheRoot', async () => {
    const runner: BuildRunner = await discoverJvm([
      { name: 'build.gradle', path: '/j/build.gradle', type: 'file' },
    ]);

    runner.runAction('build');

    expect(api.runCalls[0].command).toBe('gradle build');
    expect(api.runCalls[0].cwd).toBe('/j');
  });

  it('runAction_clean_runsMavenCleanForAMavenRoot', async () => {
    const runner: BuildRunner = await discoverJvm([
      { name: 'pom.xml', path: '/j/pom.xml', type: 'file' },
    ]);

    runner.runAction('clean');

    expect(api.runCalls[0].command).toBe('mvn clean');
  });

  it('runConfiguration_jvmGradle_runsGradleRun', async () => {
    const runner: BuildRunner = await discoverJvm([
      { name: 'build.gradle', path: '/j/build.gradle', type: 'file' },
      { name: 'gradlew', path: '/j/gradlew', type: 'file' },
    ]);

    runner.runConfiguration({ id: '/j/build.gradle', name: 'j', providerKind: 'jvm', mode: 'run' });

    expect(api.runCalls[0].command).toBe('./gradlew run');
  });

  it('runConfiguration_jvmMaven_runsMavenExecJava', async () => {
    const runner: BuildRunner = await discoverJvm([
      { name: 'pom.xml', path: '/j/pom.xml', type: 'file' },
    ]);

    runner.runConfiguration({ id: '/j/pom.xml', name: 'j', providerKind: 'jvm', mode: 'run' });

    expect(api.runCalls[0].command).toBe('mvn exec:java');
  });

  it('discover_findsACmakeBuildTaskSoTheBuildButtonEnables', async () => {
    const workspace: Workspace = TestBed.inject(Workspace);
    workspace.openListing({
      path: '/c',
      name: 'c',
      entries: [{ name: 'CMakeLists.txt', path: '/c/CMakeLists.txt', type: 'file' }],
    });
    const runner: BuildRunner = TestBed.inject(BuildRunner);
    await runner.refresh();

    const build: BuildTask | undefined = runner
      .tasks()
      .find((t: BuildTask): boolean => t.id === 'cmake:build');
    expect(build?.group).toBe('build');
    expect(build?.command).toBe('cmake -S . -B build && cmake --build build');
  });

  it('runAction_clean_runsCmakeCleanForACmakeRoot', async () => {
    const workspace: Workspace = TestBed.inject(Workspace);
    workspace.openListing({
      path: '/c',
      name: 'c',
      entries: [{ name: 'CMakeLists.txt', path: '/c/CMakeLists.txt', type: 'file' }],
    });
    const runner: BuildRunner = TestBed.inject(BuildRunner);
    await runner.refresh();

    runner.runAction('clean');

    expect(api.runCalls[0].command).toBe('cmake --build build --target clean');
  });

  it('runAction_rebuild_runsMakeCleanThenMakeForAMakefileRoot', async () => {
    const workspace: Workspace = TestBed.inject(Workspace);
    workspace.openListing({
      path: '/m',
      name: 'm',
      entries: [{ name: 'Makefile', path: '/m/Makefile', type: 'file' }],
    });
    const runner: BuildRunner = TestBed.inject(BuildRunner);
    await runner.refresh();

    runner.runAction('rebuild');

    expect(api.runCalls[0].command).toBe('make clean && make');
  });

  it('runConfiguration_cpp_buildsThenRunsTheTargetBinary', async () => {
    const workspace: Workspace = TestBed.inject(Workspace);
    workspace.openListing({
      path: '/c',
      name: 'c',
      entries: [{ name: 'CMakeLists.txt', path: '/c/CMakeLists.txt', type: 'file' }],
    });
    const runner: BuildRunner = TestBed.inject(BuildRunner);
    await runner.refresh();

    runner.runConfiguration({ id: 'app', name: 'app', providerKind: 'cpp', mode: 'run' });

    expect(api.runCalls[0].command).toBe('cmake --build build --target app && ./build/app');
  });

  /**
   * Opens a Cargo workspace root and discovers its tasks.
   * @returns Returns the build runner after discovery.
   */
  async function discoverCargo(): Promise<BuildRunner> {
    const workspace: Workspace = TestBed.inject(Workspace);
    workspace.openListing({
      path: '/r',
      name: 'r',
      entries: [{ name: 'Cargo.toml', path: '/r/Cargo.toml', type: 'file' }],
    });
    const runner: BuildRunner = TestBed.inject(BuildRunner);
    await runner.refresh();
    return runner;
  }

  it('discover_findsCargoBuildTestAndRunTasks', async () => {
    const runner: BuildRunner = await discoverCargo();

    const ids: string[] = runner.tasks().map((t: BuildTask): string => t.id);
    expect(ids).toContain('cargo:build');
    expect(ids).toContain('cargo:test');
    expect(ids).toContain('cargo:run');
  });

  it('runAction_rebuild_runsCargoCleanThenBuild', async () => {
    const runner: BuildRunner = await discoverCargo();

    runner.runAction('rebuild');

    expect(api.runCalls[0].command).toBe('cargo clean && cargo build');
  });

  it('runConfiguration_rust_runsTheCrateWithCargoRunDashP', async () => {
    const runner: BuildRunner = await discoverCargo();

    runner.runConfiguration({ id: 'my-crate', name: 'my-crate', providerKind: 'rust', mode: 'run' });

    expect(api.runCalls[0].command).toBe('cargo run -p my-crate');
  });

  /**
   * Opens a Go module root and discovers its tasks.
   * @returns Returns the build runner after discovery.
   */
  async function discoverGo(): Promise<BuildRunner> {
    const workspace: Workspace = TestBed.inject(Workspace);
    workspace.openListing({
      path: '/g',
      name: 'g',
      entries: [{ name: 'go.mod', path: '/g/go.mod', type: 'file' }],
    });
    const runner: BuildRunner = TestBed.inject(BuildRunner);
    await runner.refresh();
    return runner;
  }

  it('discover_findsGoBuildTestAndRunTasks', async () => {
    const runner: BuildRunner = await discoverGo();

    const ids: string[] = runner.tasks().map((t: BuildTask): string => t.id);
    expect(ids).toContain('go:build');
    expect(ids).toContain('go:test');
    expect(ids).toContain('go:run');
  });

  it('runAction_clean_runsGoCleanForAGoRoot', async () => {
    const runner: BuildRunner = await discoverGo();

    runner.runAction('clean');

    expect(api.runCalls[0].command).toBe('go clean');
  });

  it('runConfiguration_go_runsGoRunDot', async () => {
    const runner: BuildRunner = await discoverGo();

    runner.runConfiguration({ id: 'widget', name: 'widget', providerKind: 'go', mode: 'run' });

    expect(api.runCalls[0].command).toBe('go run .');
  });
});
