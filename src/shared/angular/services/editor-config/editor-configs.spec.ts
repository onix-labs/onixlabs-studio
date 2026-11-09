import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { EditorConfigChannel, EditorConfigResolution } from '@shared/api/editor-config-channels';
import { FileChannel } from '@shared/api/file-channels';
import { FileWatch } from '@shared/angular/services/file-watch/file-watch';
import { Settings } from '@shared/angular/services/settings/settings';
import { EditorConfigs } from './editor-configs';

describe('EditorConfigs', () => {
  const resolution: EditorConfigResolution = {
    properties: { indentStyle: 'tab' },
    candidates: ['/a/.editorconfig'],
  };
  let invoke: ReturnType<typeof vi.fn>;
  let handlers: Map<string, (...args: unknown[]) => void>;

  beforeEach(() => {
    handlers = new Map<string, (...args: unknown[]) => void>();
    invoke = vi.fn((channel: string): Promise<unknown> =>
      Promise.resolve(channel === String(EditorConfigChannel.Resolve) ? resolution : undefined),
    );
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: {
        invoke,
        send: (): void => undefined,
        on: (channel: string, handler: (...args: unknown[]) => void): (() => void) => {
          handlers.set(channel, handler);
          return (): void => undefined;
        },
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'bridge');
    localStorage.removeItem('settings');
  });

  it('asks the main process', async () => {
    expect(await TestBed.inject(EditorConfigs).resolve('/a/b.ts')).toEqual(resolution);
    expect(invoke).toHaveBeenCalledWith(EditorConfigChannel.Resolve, '/a/b.ts');
  });

  it('answers nothing while Honour EditorConfig is off', async () => {
    TestBed.inject(Settings).set('textEditor.honourEditorConfig', false);

    const answer: EditorConfigResolution = await TestBed.inject(EditorConfigs).resolve('/a/b.ts');

    expect(answer.properties).toEqual({});
    expect(invoke).not.toHaveBeenCalled();
  });

  it('answers nothing when the question fails', async () => {
    invoke.mockRejectedValueOnce(new Error('no'));

    expect((await TestBed.inject(EditorConfigs).resolve('/a/b.ts')).properties).toEqual({});
  });

  it('tells each subscriber, and each listener once, when a shared path changes', () => {
    TestBed.inject(FileWatch);
    const configs: EditorConfigs = TestBed.inject(EditorConfigs);
    const first: Mock<() => void> = vi.fn<() => void>();
    const second: Mock<() => void> = vi.fn<() => void>();
    const listener: Mock<(path: string) => void> = vi.fn<(path: string) => void>();
    configs.onChanged(listener);
    configs.watch(['/a/.editorconfig'], first);
    configs.watch(['/a/.editorconfig'], second);

    handlers.get(FileChannel.Changed)?.('/a/.editorconfig');

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('/a/.editorconfig');
  });

  it('tells subscribers when the file goes', () => {
    TestBed.inject(FileWatch);
    const onChange: Mock<() => void> = vi.fn<() => void>();
    TestBed.inject(EditorConfigs).watch(['/a/.editorconfig'], onChange);

    handlers.get(FileChannel.Removed)?.('/a/.editorconfig');

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('stops the watch with its last subscriber', () => {
    TestBed.inject(FileWatch);
    const configs: EditorConfigs = TestBed.inject(EditorConfigs);
    const stopFirst: () => void = configs.watch(['/a/.editorconfig'], (): void => undefined);
    const stopSecond: () => void = configs.watch(['/a/.editorconfig'], (): void => undefined);

    stopFirst();
    expect(invoke).not.toHaveBeenCalledWith(FileChannel.Unwatch, '/a/.editorconfig');

    stopSecond();
    expect(invoke).toHaveBeenCalledWith(FileChannel.Unwatch, '/a/.editorconfig');
  });
});
