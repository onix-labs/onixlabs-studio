import { TestBed } from '@angular/core/testing';
import { OpenSelection } from '../../../shared/studio-api';
import {
  TaskApi,
  TaskOutputStream,
  TaskRunRequest,
  TaskRunResult,
} from '../../../shared/task-types';
import { Diagnostic, Diagnostics, DiagnosticsProvider } from '../diagnostics/diagnostics';
import { Documents } from '../documents/documents';
import { Output } from '../output/output';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { BuildRunner } from './build-runner';
import { BuildTask } from './builds';

/**
 * A controllable fake of the task-runner bridge.
 */
class FakeTaskApi implements TaskApi {
  public readonly runCalls: TaskRunRequest[] = [];
  private outputListener:
    | ((runId: string, chunk: string, stream: TaskOutputStream) => void)
    | null = null;
  private exitListener:
    | ((runId: string, code: number | null, signal: string | null) => void)
    | null = null;

  public run(request: TaskRunRequest): Promise<TaskRunResult> {
    this.runCalls.push(request);
    return Promise.resolve({ success: true, pid: 1 });
  }

  public cancel(): Promise<boolean> {
    return Promise.resolve(true);
  }

  public onOutput(
    listener: (runId: string, chunk: string, stream: TaskOutputStream) => void,
  ): () => void {
    this.outputListener = listener;
    return (): void => {
      this.outputListener = null;
    };
  }

  public onExit(
    listener: (runId: string, code: number | null, signal: string | null) => void,
  ): () => void {
    this.exitListener = listener;
    return (): void => {
      this.exitListener = null;
    };
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
  let api: FakeTaskApi;
  let diagnostics: FakeDiagnostics;

  beforeEach(() => {
    api = new FakeTaskApi();
    diagnostics = new FakeDiagnostics();
    const workspaceApi: unknown = {
      openFile: (path: string): Promise<OpenSelection | null> =>
        Promise.resolve(
          path.endsWith('package.json')
            ? {
                kind: 'file',
                file: { path, name: 'package.json', extension: '.json', content: PACKAGE_JSON },
              }
            : null,
        ),
    };
    (window as unknown as { studio: unknown }).studio = { tasks: api, workspace: workspaceApi };
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
    delete (window as unknown as { studio?: unknown }).studio;
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
