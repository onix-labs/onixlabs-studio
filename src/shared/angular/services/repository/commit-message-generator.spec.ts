import { TestBed } from '@angular/core/testing';
import { AiEvent, AiProviderInfo } from '@shared/api/ai-types';
import { AiRuntime, AiRunOptions } from '@shared/angular/services/ai-runtime/ai-runtime';
import { GitFileChange } from './repository-data';
import { Repository } from './repository';
import { CommitMessageGenerator } from './commit-message-generator';

/**
 * Builds a changed file for the generator to describe.
 * @param path The file path.
 * @param untracked Whether the file is untracked.
 * @returns Returns the file change.
 */
function makeFile(path: string, untracked?: boolean): GitFileChange {
  return {
    path,
    status: untracked === true ? 'added' : 'modified',
    additions: 1,
    deletions: 0,
    language: 'typescript',
    original: '',
    modified: '',
    untracked,
  };
}

/**
 * Builds an available provider descriptor.
 * @param id The provider identifier.
 * @param available Whether the provider can run.
 * @returns Returns the provider info.
 */
function makeProvider(id: AiProviderInfo['id'], available: boolean): AiProviderInfo {
  return {
    id,
    label: id,
    available,
    detail: '',
    models: [{ id: 'model-1', label: 'Model 1', contextWindow: 200_000 }],
    defaultModelId: 'model-1',
  };
}

/**
 * A controllable stand-in for the agent runtime that records runs and lets the test stream events.
 */
class StubRuntime {
  public isAvailable: boolean = true;
  public providers: readonly AiProviderInfo[] = [makeProvider('claude', true)];
  public runs: { providerId: string; prompt: string; options: AiRunOptions }[] = [];
  public aborted: string[] = [];
  public permissions: { permissionId: string; granted: boolean }[] = [];
  private listener: ((event: AiEvent) => void) | null = null;

  public listProviders(): Promise<readonly AiProviderInfo[]> {
    return Promise.resolve(this.providers);
  }

  public run(providerId: string, prompt: string, options: AiRunOptions): string {
    this.runs.push({ providerId, prompt, options });
    return `run-${this.runs.length}`;
  }

  public abort(requestId: string): void {
    this.aborted.push(requestId);
  }

  public onEvent(listener: (event: AiEvent) => void): () => void {
    this.listener = listener;
    return (): void => {
      this.listener = null;
    };
  }

  public respondPermission(permissionId: string, granted: boolean): void {
    this.permissions.push({ permissionId, granted });
  }

  public emit(event: AiEvent): void {
    this.listener?.(event);
  }
}

describe('CommitMessageGenerator', () => {
  let runtime: StubRuntime;
  let generator: CommitMessageGenerator;

  beforeEach(() => {
    runtime = new StubRuntime();
    TestBed.configureTestingModule({
      providers: [
        CommitMessageGenerator,
        { provide: AiRuntime, useValue: runtime },
        {
          provide: Repository,
          useValue: {
            loadDiff: (): Promise<{ original: string; modified: string }> =>
              Promise.resolve({ original: 'const a = 1;\n', modified: 'const a = 2;\n' }),
          },
        },
      ],
    });
    generator = TestBed.inject(CommitMessageGenerator);
  });

  /**
   * Waits for the generator's async provider lookup and prompt build to reach the run.
   * @returns Returns a promise that resolves on the next macrotask.
   */
  function flush(): Promise<void> {
    return new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }

  it('generate_collectsTheStreamedTextAndResolvesOnCompletion', async () => {
    const pending: Promise<string | null> = generator.generate([makeFile('a.ts')]);
    await flush();

    expect(runtime.runs).toHaveLength(1);
    expect(runtime.runs[0].options.mode).toBe('chat');
    expect(runtime.runs[0].prompt).toContain('modified a.ts');
    expect(runtime.runs[0].prompt).toContain('const a = 2;');

    runtime.emit({ requestId: 'run-1', kind: 'text', delta: 'fix: correct ' });
    runtime.emit({ requestId: 'run-1', kind: 'text', delta: 'the constant' });
    runtime.emit({ requestId: 'run-1', kind: 'status', state: 'completed', detail: '' });

    expect(await pending).toBe('fix: correct the constant');
    expect(generator.generating()).toBe(false);
  });

  it('generate_ignoresEventsFromOtherRuns', async () => {
    const pending: Promise<string | null> = generator.generate([makeFile('a.ts')]);
    await flush();

    runtime.emit({ requestId: 'other', kind: 'text', delta: 'noise' });
    runtime.emit({ requestId: 'run-1', kind: 'text', delta: 'real message' });
    runtime.emit({ requestId: 'other', kind: 'status', state: 'error', detail: '' });
    runtime.emit({ requestId: 'run-1', kind: 'status', state: 'completed', detail: '' });

    expect(await pending).toBe('real message');
  });

  it('generate_deniesPermissionRequestsSoTheRunNeverBlocks', async () => {
    const pending: Promise<string | null> = generator.generate([makeFile('a.ts')]);
    await flush();

    runtime.emit({
      requestId: 'run-1',
      kind: 'permission',
      permissionId: 'p1',
      name: '',
      detail: '',
    });
    runtime.emit({ requestId: 'run-1', kind: 'status', state: 'completed', detail: '' });
    await pending;

    expect(runtime.permissions).toEqual([{ permissionId: 'p1', granted: false }]);
  });

  it('generate_onErrorStatus_resolvesNull', async () => {
    const pending: Promise<string | null> = generator.generate([makeFile('a.ts')]);
    await flush();

    runtime.emit({ requestId: 'run-1', kind: 'text', delta: 'partial' });
    runtime.emit({ requestId: 'run-1', kind: 'status', state: 'error', detail: 'boom' });

    expect(await pending).toBeNull();
  });

  it('generate_stripsCodeFencesAndQuotesFromTheReply', async () => {
    const pending: Promise<string | null> = generator.generate([makeFile('a.ts')]);
    await flush();

    runtime.emit({
      requestId: 'run-1',
      kind: 'text',
      delta: '```\nfeat: fenced message\n```',
    });
    runtime.emit({ requestId: 'run-1', kind: 'status', state: 'completed', detail: '' });

    expect(await pending).toBe('feat: fenced message');
  });

  it('generate_withNoAvailableProvider_resolvesNull', async () => {
    runtime.providers = [makeProvider('claude', false)];

    expect(await generator.generate([makeFile('a.ts')])).toBeNull();
    expect(runtime.runs).toHaveLength(0);
  });

  it('generate_withNoFiles_resolvesNull', async () => {
    expect(await generator.generate([])).toBeNull();
    expect(runtime.runs).toHaveLength(0);
  });

  it('generate_labelsUntrackedFilesInThePrompt', async () => {
    const pending: Promise<string | null> = generator.generate([makeFile('new.ts', true)]);
    await flush();

    expect(runtime.runs[0].prompt).toContain('new (untracked) new.ts');

    runtime.emit({ requestId: 'run-1', kind: 'status', state: 'completed', detail: '' });
    await pending;
  });
});
