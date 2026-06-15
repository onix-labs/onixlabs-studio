import { TestBed } from '@angular/core/testing';
import { TempFileResult } from '../../../../shared/studio-api';
import { Task } from '../task';
import { RunFileTaskProvider } from './run-file-task-provider';

describe('RunFileTaskProvider', () => {
  let writeCalls: { key: string; extension: string; content: string }[];

  beforeEach(() => {
    writeCalls = [];
    const run: unknown = {
      writeTempFile: (key: string, extension: string, content: string): Promise<TempFileResult> => {
        writeCalls.push({ key, extension, content });
        return Promise.resolve({ success: true, path: `/tmp/${key}/run${extension}` });
      },
    };
    (window as unknown as { studio: { run: unknown } }).studio = { run };
  });

  afterEach(() => {
    delete (window as unknown as { studio?: unknown }).studio;
  });

  it('canRun_reflectsTheRunnerTable', () => {
    const provider: RunFileTaskProvider = TestBed.inject(RunFileTaskProvider);

    expect(provider.canRun('typescript')).toBe(true);
    expect(provider.canRun('plaintext')).toBe(false);
  });

  it('buildTask_forRunnableLanguage_targetsTheDockedTerminal', () => {
    const provider: RunFileTaskProvider = TestBed.inject(RunFileTaskProvider);
    const task: Task | null = provider.buildTask({
      tabId: 'tab-1',
      language: 'python',
      content: 'print(1)',
    });

    expect(task?.target).toBe('terminal');
    expect(task?.terminalTabId).toBe('tab-1');
  });

  it('buildTask_forUnrunnableLanguage_returnsNull', () => {
    const provider: RunFileTaskProvider = TestBed.inject(RunFileTaskProvider);

    expect(provider.buildTask({ tabId: 'tab-1', language: 'plaintext', content: '' })).toBeNull();
  });

  it('resolve_writesATempFileAndBuildsTheCommand', async () => {
    const provider: RunFileTaskProvider = TestBed.inject(RunFileTaskProvider);
    const task: Task | null = provider.buildTask({
      tabId: 'tab-1',
      language: 'python',
      content: 'print(1)',
    });
    const command: string | null = (await task?.resolve()) ?? null;

    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0].extension).toBe('.py');
    expect(command).toBe('python3 "/tmp/tab-1/run.py"');
  });

  it('provideTasks_withRunnableActiveDocument_returnsTheTask', () => {
    const provider: RunFileTaskProvider = TestBed.inject(RunFileTaskProvider);
    const tasks: Task[] = provider.provideTasks({
      activeDocument: { tabId: 'tab-1', language: 'javascript', content: 'x' },
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0].label).toBe('Run File');
  });

  it('provideTasks_withoutActiveDocument_returnsEmpty', () => {
    const provider: RunFileTaskProvider = TestBed.inject(RunFileTaskProvider);

    expect(provider.provideTasks({})).toEqual([]);
  });
});
