import { computed, effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { DirectoryChangeEvent } from '@shared/api/file-channels';
import { StudioChannel } from '@shared/api/studio-channels';
import {
  emptySnapshot,
  resolveSelectedRunConfiguration,
  RunConfiguration,
  STUDIO_DIR,
  StudioSnapshot,
  StudioUser,
  StudioWorkspace,
} from '@shared/api/studio';
import { DirectoryWatch } from '@shared/angular/services/directory-watch/directory-watch';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';

/**
 * How long, in milliseconds, `.studio` change notifications are ignored after the service writes a
 * file itself, so a save's own directory-change event does not trigger a reload. The window comfortably
 * covers the watcher's coalescing delay while staying short enough that a genuine external edit made
 * moments later is still picked up on the next change.
 */
const SELF_WRITE_GUARD_MS: number = 1000;

/**
 * The renderer-side view of the active workspace's `.studio` persistence. It loads the merged snapshot
 * (shared `workspace.json` plus the developer's `workspace.user.json`) whenever the open root changes,
 * exposes the run configurations and transient selections as signals, and saves changes back through
 * the main-process store. External edits to the `.studio` folder reload the snapshot automatically via
 * the directory watch; the service ignores the change events raised by its own writes.
 *
 * The shared file owns the run configurations; the user file owns only the transient selections
 * (selected configuration, last target, last build configuration), so the two are layered rather than
 * merged — the developer's file can select among the shared configurations but never redefines them.
 */
@Service()
export class StudioConfig {
  /**
   * Holds the app-level active-workspace seam projecting the active tab's open root. This is read
   * rather than the scoped {@link Workspace} because {@link StudioConfig} is an app-level singleton and
   * each directory tab's open folder lives in that tab's own scoped {@link Workspace}; only
   * {@link ActiveWorkspace} resolves the active tab back to its root from here.
   */
  private readonly activeWorkspace: ActiveWorkspace = inject(ActiveWorkspace);

  /**
   * Holds the directory-watch service the `.studio` folder is observed through.
   */
  private readonly directoryWatch: DirectoryWatch = inject(DirectoryWatch);

  /**
   * Holds the generic transport, or undefined outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the current snapshot for the open root, defaulting to an empty snapshot.
   */
  private readonly current: WritableSignal<StudioSnapshot> =
    signal<StudioSnapshot>(emptySnapshot());

  /**
   * Holds the generation of the current load, so a stale load (the root changed while it was in flight)
   * does not apply its results.
   */
  private generation: number = 0;

  /**
   * Holds the timestamp until which `.studio` change events are treated as the echo of our own write.
   */
  private suppressReloadUntil: number = 0;

  /**
   * Gets the shared run configurations for the active workspace.
   */
  public readonly runConfigurations: Signal<readonly RunConfiguration[]> = computed(
    (): readonly RunConfiguration[] => this.current().workspace.runConfigurations,
  );

  /**
   * Gets the effective selected run configuration, applying the shared-vs-user precedence, or null when
   * there are none.
   */
  public readonly selectedRunConfiguration: Signal<RunConfiguration | null> = computed(
    (): RunConfiguration | null => resolveSelectedRunConfiguration(this.current()),
  );

  /**
   * Gets the id of the last-selected target option, or undefined when none was selected.
   */
  public readonly lastTarget: Signal<string | undefined> = computed(
    (): string | undefined => this.current().user.lastTarget,
  );

  /**
   * Gets the id of the last-selected build configuration, or undefined when none was selected.
   */
  public readonly lastBuildConfiguration: Signal<string | undefined> = computed(
    (): string | undefined => this.current().user.lastBuildConfiguration,
  );

  /**
   * Loads the snapshot when the open root changes and keeps it in step with external `.studio` edits.
   */
  public constructor() {
    effect((onCleanup: (fn: () => void) => void): void => {
      const root: string | null = this.activeWorkspace.rootPath();
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
   * Replaces the shared configuration (the run configurations), persisting it to `workspace.json`.
   * @param workspace The new shared configuration.
   * @returns Returns a promise that resolves once the write is issued.
   */
  public async saveWorkspace(workspace: StudioWorkspace): Promise<void> {
    this.current.set({ workspace, user: this.current().user });
    await this.persist(StudioChannel.SaveWorkspace, workspace);
  }

  /**
   * Replaces just the run configurations, preserving the rest of the shared configuration (schema
   * version, provider selection), and persists to `workspace.json`.
   * @param configurations The new run configurations.
   * @returns Returns a promise that resolves once the write is issued.
   */
  public saveRunConfigurations(configurations: readonly RunConfiguration[]): Promise<void> {
    return this.saveWorkspace({ ...this.current().workspace, runConfigurations: configurations });
  }

  /**
   * Selects a run configuration, persisting the choice to the per-developer `workspace.user.json`.
   * @param id The id of the run configuration to select, or undefined to clear the selection.
   * @returns Returns a promise that resolves once the write is issued.
   */
  public setSelectedRunConfiguration(id: string | undefined): Promise<void> {
    return this.saveUser({ ...this.current().user, selectedRunConfigurationId: id });
  }

  /**
   * Records the last-selected target option in the per-developer file.
   * @param id The target-option id, or undefined to clear it.
   * @returns Returns a promise that resolves once the write is issued.
   */
  public setLastTarget(id: string | undefined): Promise<void> {
    return this.saveUser({ ...this.current().user, lastTarget: id });
  }

  /**
   * Records the last-selected build configuration in the per-developer file.
   * @param id The build-configuration id, or undefined to clear it.
   * @returns Returns a promise that resolves once the write is issued.
   */
  public setLastBuildConfiguration(id: string | undefined): Promise<void> {
    return this.saveUser({ ...this.current().user, lastBuildConfiguration: id });
  }

  /**
   * Writes the per-developer user configuration, applying it locally first.
   * @param user The new user configuration.
   * @returns Returns a promise that resolves once the write is issued.
   */
  private async saveUser(user: StudioUser): Promise<void> {
    this.current.set({ workspace: this.current().workspace, user });
    await this.persist(StudioChannel.SaveUser, user);
  }

  /**
   * Issues a save over the given channel and suppresses the resulting `.studio` change event so the
   * write does not trigger a reload of what we just wrote.
   * @param channel The save channel.
   * @param payload The shared or user configuration to write.
   */
  private async persist(
    channel: StudioChannel,
    payload: StudioWorkspace | StudioUser,
  ): Promise<void> {
    const root: string | null = this.activeWorkspace.rootPath();
    if (this.bridge === undefined || root === null) {
      return;
    }
    this.suppressReloadUntil = Date.now() + SELF_WRITE_GUARD_MS;
    await this.bridge.invoke(channel, root, payload);
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
   * Reloads the snapshot when the workspace's `.studio` folder changes on disk, unless the change is
   * the echo of our own recent write.
   * @param root The workspace root the change occurred under.
   * @param event The directory-change event.
   */
  private onDirectoryChanged(root: string, event: DirectoryChangeEvent): void {
    if (Date.now() < this.suppressReloadUntil) {
      return;
    }
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
