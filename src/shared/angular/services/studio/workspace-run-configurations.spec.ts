import { ApplicationRef, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Bridge } from '@shared/api/bridge';
import { DirectoryChangeEvent } from '@shared/api/file-channels';
import { StudioChannel } from '@shared/api/studio-channels';
import { RunConfiguration, StudioSnapshot } from '@shared/api/studio';
import { DirectoryWatch } from '@shared/angular/services/directory-watch/directory-watch';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { WorkspaceRunConfigurations } from './workspace-run-configurations';

/**
 * A fake transport whose studio snapshot the test controls. Routes the Load channel; everything else
 * resolves to null.
 */
class FakeBridge implements Bridge {
  public snapshot: StudioSnapshot | null = null;

  public invoke<T>(channel: string): Promise<T> {
    if (channel === (StudioChannel.Load as string)) {
      return Promise.resolve(this.snapshot as T);
    }
    return Promise.resolve(null as T);
  }

  public send(): void {
    return undefined;
  }

  public on(): () => void {
    return (): void => undefined;
  }
}

/**
 * A fake directory watch that captures the subscriber so the test can drive change events directly.
 */
class FakeDirectoryWatch {
  public onChange: ((event: DirectoryChangeEvent) => void) | null = null;

  public watch(_root: string, onChange: (event: DirectoryChangeEvent) => void): () => void {
    this.onChange = onChange;
    return (): void => {
      this.onChange = null;
    };
  }

  public emit(directories: readonly string[], overflow: boolean = false): void {
    this.onChange?.({ root: '/root', directories: [...directories], overflow });
  }
}

/**
 * Builds a run configuration, optionally flagged as the workspace default.
 * @param id The configuration id.
 * @param isDefault Whether it is the workspace default.
 * @returns Returns the configuration.
 */
function config(id: string, isDefault: boolean = false): RunConfiguration {
  return {
    id,
    name: id.toUpperCase(),
    providerKind: 'dotnet',
    mode: 'run',
    default: isDefault ? true : undefined,
  };
}

/**
 * A snapshot with the given configurations.
 * @param configurations The run configurations.
 * @returns Returns the snapshot.
 */
function snapshotOf(configurations: readonly RunConfiguration[]): StudioSnapshot {
  return { workspace: { version: 1, runConfigurations: configurations }, user: { version: 1 } };
}

/**
 * Resolves pending microtasks so the service's async loads settle.
 * @returns Returns a promise that resolves on the next macrotask.
 */
function flush(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

describe('WorkspaceRunConfigurations', () => {
  let bridge: FakeBridge;
  let watch: FakeDirectoryWatch;
  let root: WritableSignal<{ path: string } | null>;

  /**
   * Builds the service under test with the fakes wired in, reading its root from a fake Workspace.
   * @returns Returns the service.
   */
  function build(): WorkspaceRunConfigurations {
    TestBed.configureTestingModule({
      providers: [
        WorkspaceRunConfigurations,
        { provide: Workspace, useValue: { root } },
        { provide: DirectoryWatch, useValue: watch },
      ],
    });
    return TestBed.inject(WorkspaceRunConfigurations);
  }

  /**
   * Runs the open-root effect and lets the async load settle.
   * @returns Returns a promise that resolves once the service has settled.
   */
  async function settle(): Promise<void> {
    TestBed.inject(ApplicationRef).tick();
    await flush();
  }

  beforeEach(() => {
    bridge = new FakeBridge();
    watch = new FakeDirectoryWatch();
    root = signal<{ path: string } | null>(null);
    (window as unknown as { bridge: Bridge }).bridge = bridge;
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: Bridge }).bridge;
  });

  it('readsTheWorkspaceOwnRootDefault', async () => {
    bridge.snapshot = snapshotOf([config('a'), config('b', true)]);
    const service: WorkspaceRunConfigurations = build();
    root.set({ path: '/root' });
    await settle();

    expect(service.configurations().map((c: RunConfiguration): string => c.id)).toEqual(['a', 'b']);
    expect(service.defaultConfiguration()?.id).toBe('b');
  });

  it('hasNoDefaultWhenNoneIsFlagged', async () => {
    bridge.snapshot = snapshotOf([config('a'), config('b')]);
    const service: WorkspaceRunConfigurations = build();
    root.set({ path: '/root' });
    await settle();

    expect(service.defaultConfiguration()).toBeNull();
  });

  it('resetsToEmptyWhenNoFolderIsOpen', async () => {
    bridge.snapshot = snapshotOf([config('a', true)]);
    const service: WorkspaceRunConfigurations = build();
    await settle();

    expect(service.configurations()).toEqual([]);
    expect(service.defaultConfiguration()).toBeNull();
  });

  it('reloadsWhenTheStudioFolderChanges', async () => {
    bridge.snapshot = snapshotOf([config('a')]);
    const service: WorkspaceRunConfigurations = build();
    root.set({ path: '/root' });
    await settle();
    expect(service.defaultConfiguration()).toBeNull();

    // The workspace sets a default while active — its `.studio` folder changes on disk.
    bridge.snapshot = snapshotOf([config('a', true)]);
    watch.emit(['/root/.studio']);
    await flush();

    expect(service.defaultConfiguration()?.id).toBe('a');
  });

  it('ignoresChangesOutsideTheStudioFolder', async () => {
    bridge.snapshot = snapshotOf([config('a', true)]);
    const service: WorkspaceRunConfigurations = build();
    root.set({ path: '/root' });
    await settle();

    // A change elsewhere must not trigger a reload — swap the snapshot and confirm it is not picked up.
    bridge.snapshot = snapshotOf([config('a')]);
    watch.emit(['/root/src']);
    await flush();

    expect(service.defaultConfiguration()?.id).toBe('a');
  });
});
