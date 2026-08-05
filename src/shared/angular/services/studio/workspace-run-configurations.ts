import { computed, effect, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { DirectoryChangeEvent } from '@shared/api/file-channels';
import { StudioChannel } from '@shared/api/studio-channels';
import {
  emptySnapshot,
  resolveDefaultRunConfiguration,
  RunConfiguration,
  STUDIO_DIR,
  StudioSnapshot,
} from '@shared/api/studio';
import { DirectoryWatch } from '@shared/angular/services/directory-watch/directory-watch';
import { Workspace } from '@shared/angular/services/workspace/workspace';

/**
 * One workspace's `.studio` run configurations, read from its OWN open root rather than the active
 * one.
 *
 * {@link import('./studio-config').StudioConfig} is an app-level singleton scoped to whichever
 * directory tab is active, so it cannot answer "what is THAT background workspace's default
 * configuration" — which is exactly what Mission Control's per-agent Run button needs, since it shows
 * every open workspace's agent at once, not just the active one's. This service is provided per
 * directory tab (beside the tab's other scoped state), reads that tab's own root, and stays in step
 * with external `.studio` edits through the directory watch — including the workspace's own Configure
 * edits while it is active.
 *
 * It is deliberately read-only: authoring run configurations still goes through the active-scoped
 * {@link import('./studio-config').StudioConfig}, so there is one writer and this is only a per-root
 * reader. It mirrors that service's load-and-watch read half (the two cannot share one instance
 * because one is active-scoped and this is per-tab), with no self-write guard since it never writes.
 */
@Service()
export class WorkspaceRunConfigurations {
  /**
   * Holds this tab's scoped workspace, whose open root the configurations are read from.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the directory-watch service the workspace's `.studio` folder is observed through.
   */
  private readonly directoryWatch: DirectoryWatch = inject(DirectoryWatch);

  /**
   * Holds the generic transport, or undefined outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the current snapshot for this workspace's root, defaulting to an empty snapshot.
   */
  private readonly current: WritableSignal<StudioSnapshot> =
    signal<StudioSnapshot>(emptySnapshot());

  /**
   * Holds the generation of the current load, so a stale load (the root changed while it was in
   * flight) does not apply its results.
   */
  private generation: number = 0;

  /**
   * Gets this workspace's shared run configurations.
   */
  public readonly configurations: Signal<readonly RunConfiguration[]> = computed(
    (): readonly RunConfiguration[] => this.current().workspace.runConfigurations,
  );

  /**
   * Gets this workspace's default run configuration, or null when none is flagged.
   */
  public readonly defaultConfiguration: Signal<RunConfiguration | null> = computed(
    (): RunConfiguration | null => resolveDefaultRunConfiguration(this.configurations()),
  );

  /**
   * Loads the snapshot when the workspace's open root changes and keeps it in step with external
   * `.studio` edits.
   */
  public constructor() {
    effect((onCleanup: (fn: () => void) => void): void => {
      const root: string | null = this.workspace.root()?.path ?? null;
      void this.reload(root);
      if (root === null) {
        return;
      }
      const dispose: () => void = this.directoryWatch.watch(
        root,
        (event: DirectoryChangeEvent): void => this.onDirectoryChanged(root, event),
      );
      onCleanup((): void => dispose());
    });
  }

  /**
   * Reloads the snapshot for a root, or resets to an empty snapshot when no folder is open. A stale
   * load (the root changed mid-flight) is discarded.
   * @param root The workspace root, or null when no folder is open.
   */
  private async reload(root: string | null): Promise<void> {
    const generation: number = ++this.generation;
    if (this.bridge === undefined || root === null) {
      this.current.set(emptySnapshot());
      return;
    }
    const snapshot: StudioSnapshot | null = await this.bridge.invoke<StudioSnapshot | null>(
      StudioChannel.Load,
      root,
    );
    if (generation !== this.generation) {
      return;
    }
    this.current.set(snapshot ?? emptySnapshot());
  }

  /**
   * Reloads the snapshot when the workspace's `.studio` folder changes on disk.
   * @param root The workspace root the change occurred under.
   * @param event The directory-change event.
   */
  private onDirectoryChanged(root: string, event: DirectoryChangeEvent): void {
    const touchesStudio: boolean =
      event.overflow ||
      event.directories.some((directory: string): boolean => this.isStudioDir(directory));
    if (touchesStudio) {
      void this.reload(root);
    }
  }

  /**
   * Determines whether a changed directory is a workspace's `.studio` folder, comparing the trailing
   * path segment so the check holds regardless of path separator.
   * @param directory The absolute directory path.
   * @returns Returns true when the directory is a `.studio` folder.
   */
  private isStudioDir(directory: string): boolean {
    const segments: string[] = directory.split(/[\\/]/);
    return segments[segments.length - 1] === STUDIO_DIR;
  }
}
