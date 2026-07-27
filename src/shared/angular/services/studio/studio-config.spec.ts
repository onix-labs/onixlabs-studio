import { ApplicationRef, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Bridge } from '@shared/api/bridge';
import { DirectoryChangeEvent } from '@shared/api/file-channels';
import { StudioChannel } from '@shared/api/studio-channels';
import { RunConfiguration, StudioSnapshot } from '@shared/api/studio';
import { DirectoryWatch } from '@shared/angular/services/directory-watch/directory-watch';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { StudioConfig } from './studio-config';

/**
 * A recorded save issued through the fake transport.
 */
interface RecordedSave {
  readonly channel: string;
  readonly root: string;
  readonly payload: unknown;
}

/**
 * A fake transport whose studio snapshot the test controls and which records the saves it is asked to
 * make. Routes the studio channels; other channels resolve to null.
 */
class FakeBridge implements Bridge {
  public snapshot: StudioSnapshot | null = null;
  public readonly saves: RecordedSave[] = [];

  public invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    if (channel === (StudioChannel.Load as string)) {
      return Promise.resolve(this.snapshot as T);
    }
    if (
      channel === (StudioChannel.SaveWorkspace as string) ||
      channel === (StudioChannel.SaveUser as string)
    ) {
      this.saves.push({ channel, root: args[0] as string, payload: args[1] });
      return Promise.resolve(true as T);
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
 * Builds a run configuration with the given id and name.
 * @param id The configuration id.
 * @param name The configuration name.
 * @returns Returns the configuration.
 */
function config(id: string, name: string): RunConfiguration {
  return { id, name, providerKind: 'dotnet', mode: 'run' };
}

/**
 * A snapshot with two configurations, selection 'b', and transient target/build-configuration.
 * @returns Returns the snapshot.
 */
function sampleSnapshot(): StudioSnapshot {
  return {
    workspace: { version: 1, runConfigurations: [config('a', 'A'), config('b', 'B')] },
    user: {
      version: 1,
      selectedRunConfigurationId: 'b',
      lastTarget: 'x64',
      lastBuildConfiguration: 'release',
    },
  };
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

describe('StudioConfig', () => {
  let bridge: FakeBridge;
  let watch: FakeDirectoryWatch;
  let rootPath: WritableSignal<string | null>;

  /**
   * Builds the service under test with the fakes wired in.
   * @returns Returns the service.
   */
  function build(): StudioConfig {
    TestBed.configureTestingModule({
      providers: [
        StudioConfig,
        { provide: ActiveWorkspace, useValue: { rootPath } },
        { provide: DirectoryWatch, useValue: watch },
      ],
    });
    return TestBed.inject(StudioConfig);
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
    rootPath = signal<string | null>(null);
    (window as unknown as { bridge: Bridge }).bridge = bridge;
  });

  afterEach(() => {
    // Remove the fake bridge so a later spec asserting its absence (e.g. file-system) is not polluted.
    delete (window as unknown as { bridge?: Bridge }).bridge;
  });

  it('loadsTheSnapshotWhenARootOpens', async () => {
    bridge.snapshot = sampleSnapshot();
    const studio: StudioConfig = build();
    rootPath.set('/root');
    await settle();

    expect(studio.runConfigurations().map((c) => c.id)).toEqual(['a', 'b']);
    expect(studio.selectedRunConfiguration()?.id).toBe('b');
    expect(studio.lastTarget()).toBe('x64');
    expect(studio.lastBuildConfiguration()).toBe('release');
  });

  it('resetsToAnEmptySnapshotWhenNoFolderIsOpen', async () => {
    bridge.snapshot = sampleSnapshot();
    const studio: StudioConfig = build();
    await settle();

    expect(studio.runConfigurations()).toEqual([]);
    expect(studio.selectedRunConfiguration()).toBeNull();
  });

  it('savesTheSharedConfigurationThroughTheWorkspaceChannel', async () => {
    const studio: StudioConfig = build();
    rootPath.set('/root');
    await settle();

    await studio.saveWorkspace({ version: 1, runConfigurations: [config('x', 'X')] });

    expect(bridge.saves).toHaveLength(1);
    expect(bridge.saves[0].channel).toBe(StudioChannel.SaveWorkspace);
    expect(bridge.saves[0].root).toBe('/root');
    expect(studio.runConfigurations().map((c) => c.id)).toEqual(['x']);
  });

  it('saveRunConfigurations_replacesConfigsAndPreservesTheRestOfTheWorkspace', async () => {
    bridge.snapshot = {
      workspace: { version: 1, runConfigurations: [config('a', 'A')], providerKind: 'dotnet' },
      user: { version: 1 },
    };
    const studio: StudioConfig = build();
    rootPath.set('/root');
    await settle();

    await studio.saveRunConfigurations([config('x', 'X')]);

    expect(bridge.saves[0].channel).toBe(StudioChannel.SaveWorkspace);
    expect(bridge.saves[0].payload).toEqual({
      version: 1,
      runConfigurations: [config('x', 'X')],
      providerKind: 'dotnet',
    });
    expect(studio.runConfigurations().map((c) => c.id)).toEqual(['x']);
  });

  it('persistsAndAppliesASelectionThroughTheUserChannel', async () => {
    bridge.snapshot = sampleSnapshot();
    const studio: StudioConfig = build();
    rootPath.set('/root');
    await settle();

    await studio.setSelectedRunConfiguration('a');

    expect(bridge.saves[0].channel).toBe(StudioChannel.SaveUser);
    expect(studio.selectedRunConfiguration()?.id).toBe('a');
  });

  it('reloadsWhenTheStudioFolderChangesExternally', async () => {
    bridge.snapshot = sampleSnapshot();
    const studio: StudioConfig = build();
    rootPath.set('/root');
    await settle();

    bridge.snapshot = {
      workspace: { version: 1, runConfigurations: [config('z', 'Z')] },
      user: { version: 1 },
    };
    watch.emit(['/root/.studio']);
    await settle();

    expect(studio.runConfigurations().map((c) => c.id)).toEqual(['z']);
  });

  it('ignoresChangesOutsideTheStudioFolder', async () => {
    bridge.snapshot = sampleSnapshot();
    const studio: StudioConfig = build();
    rootPath.set('/root');
    await settle();

    bridge.snapshot = {
      workspace: { version: 1, runConfigurations: [config('z', 'Z')] },
      user: { version: 1 },
    };
    watch.emit(['/root/src']);
    await settle();

    expect(studio.runConfigurations().map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('doesNotReloadFromItsOwnWrite', async () => {
    const studio: StudioConfig = build();
    rootPath.set('/root');
    await settle();

    // A save sets the self-write guard; the change event it would raise must not overwrite what we set.
    await studio.saveWorkspace({ version: 1, runConfigurations: [config('x', 'X')] });
    bridge.snapshot = {
      workspace: { version: 1, runConfigurations: [config('z', 'Z')] },
      user: { version: 1 },
    };
    watch.emit(['/root/.studio']);
    await settle();

    expect(studio.runConfigurations().map((c) => c.id)).toEqual(['x']);
  });
});
