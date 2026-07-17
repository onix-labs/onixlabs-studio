import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { RunChannel, TempFileResult } from '@shared/api/run-channels';
import { Task } from '../task';
import { RunFileTaskProvider } from './run-file-task-provider';

describe('RunFileTaskProvider', () => {
  let writeCalls: { key: string; extension: string; content: string }[];

  beforeEach(() => {
    writeCalls = [];
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        if (channel === (RunChannel.WriteTempFile as string)) {
          const [key, extension, content] = args as [string, string, string];
          writeCalls.push({ key, extension, content });
          const result: TempFileResult = { success: true, path: `/tmp/${key}/run${extension}` };
          return Promise.resolve(result as T);
        }
        return Promise.resolve(null as T);
      },
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  it('canRun_reflectsTheRunnerTable', () => {
    const provider: RunFileTaskProvider = TestBed.inject(RunFileTaskProvider);

    expect(provider.canRun('typescript')).toBe(true);
    expect(provider.canRun('java')).toBe(true);
    expect(provider.canRun('plaintext')).toBe(false);
  });

  it('resolve_forJava_runsTheFileWithTheSourceLauncher', async () => {
    const provider: RunFileTaskProvider = TestBed.inject(RunFileTaskProvider);
    const task: Task | null = provider.buildTask({
      tabId: 'tab-1',
      language: 'java',
      content: 'class Main { public static void main(String[] a) {} }',
    });
    const command: string | null = (await task?.resolve()) ?? null;

    expect(writeCalls[0].extension).toBe('.java');
    expect(command).toBe('java "/tmp/tab-1/run.java"');
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
