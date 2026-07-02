import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { OpenSelection, WorkspaceChannel } from '@shared/api/workspace-channels';
import { TaskChannel, TaskRunRequest } from '@shared/api/task-channels';
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
});
