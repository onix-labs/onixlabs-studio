import { computed, inject, Injector, Service, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel, DockPanelSwitch } from '@shared/angular/services/dock-layout/dock-panel';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { findStackOfPanel } from '@shared/angular/services/dock-layout/dock-tree';
import { Documents } from '@shared/angular/services/documents/documents';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { GitFileChange } from '@shared/angular/services/repository/repository-data';
import { Repository } from '@shared/angular/services/repository/repository';
import { Settings } from '@shared/angular/services/settings/settings';
import { DiffOpener } from './diff-opener';
import { Diffs } from './diffs';

/**
 * Switches a document well's tab between a file and its diff — the Show Diff and Show File buttons on
 * the file's and the diff's tool strips. Whether the tab being left stays open beside the other view or is replaced
 * by it is the user's choice (the `workspaces.documentDiffSwitch` setting).
 *
 * The openers are reached through the injector when a switch is made rather than injected up front,
 * because both of them build their panels' switches here: an eager injection would be a cycle.
 */
@Service()
export class DocumentDiffSwitch {
  /**
   * Holds the injector the openers are resolved from when a switch is made.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the dock layout the tabs live in.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the dock panel registry, for the close guard of a file being replaced.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Holds the document model, which knows each file tab's path.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the diff content store, which knows each diff tab's change.
   */
  private readonly diffs: Diffs = inject(Diffs);

  /**
   * Holds the repository whose changes decide whether a file has a diff.
   */
  private readonly repository: Repository = inject(Repository);

  /**
   * Holds the settings that choose between a separate tab and replacing the current one.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Builds the switch a file's tab offers: to the file's diff, while it has changes.
   * @param panelId The file tab's panel (and document) identifier.
   * @returns Returns the switch, kept current as the file's status changes.
   */
  public forFile(panelId: string): Signal<DockPanelSwitch> {
    return computed((): DockPanelSwitch => {
      const path: string | null = this.documents.get(panelId)?.filePath() ?? null;
      return {
        label: 'Show Diff',
        icon: Icon.GIT_DIFF,
        unavailable: this.diffUnavailable(path),
        run: (): Promise<boolean> => this.toDiff(panelId),
      };
    });
  }

  /**
   * Builds the switch a diff's tab offers: to the file it compares, unless the change deleted it.
   * @param panelId The diff tab's panel identifier.
   * @returns Returns the switch.
   */
  public forDiff(panelId: string): Signal<DockPanelSwitch> {
    return computed((): DockPanelSwitch => {
      const change: GitFileChange | null = this.diffs.get(panelId);
      return {
        label: 'Show File',
        icon: Icon.OPEN_FILE,
        unavailable:
          change?.status === 'deleted'
            ? 'The change deletes this file, so there is no file to show.'
            : this.absolutePath(change) === null
              ? 'This diff has no file to show.'
              : null,
        run: (): Promise<boolean> => this.toFile(panelId),
      };
    });
  }

  /**
   * Gets why a file has no diff to switch to, or null when it has one.
   * @param path The file's absolute path, or null for a document not backed by a file.
   * @returns Returns the reason, or null.
   */
  private diffUnavailable(path: string | null): string | null {
    if (path === null) {
      return 'This document is not saved to a file, so there is no diff to show.';
    }
    if (!this.repository.isBound()) {
      return 'This workspace is not a git repository, so there is no diff to show.';
    }
    return this.injector.get(DiffOpener).changeForPath(path) === undefined
      ? 'No changes against HEAD'
      : null;
  }

  /**
   * Switches a file's tab to its diff.
   * @param fileId The file tab's panel identifier.
   * @returns Returns true once the diff is showing.
   */
  private async toDiff(fileId: string): Promise<boolean> {
    const path: string | null = this.documents.get(fileId)?.filePath() ?? null;
    const well: StackNode | null = findStackOfPanel(this.dockState.layout(), fileId);
    if (path === null || well === null) {
      return false;
    }
    const replace: boolean = this.settings.documentDiffSwitch() === 'swap';
    // The file's unsaved changes are settled before anything moves, so a cancelled prompt leaves the
    // well exactly as it was.
    const file: DockPanel | undefined = this.registry.get(fileId);
    if (replace && file?.confirmClose !== undefined && !(await file.confirmClose())) {
      return false;
    }
    const opener: DiffOpener = this.injector.get(DiffOpener);
    if ((await opener.openPath(path, well.id)) !== null) {
      return false;
    }
    if (replace) {
      this.replace(fileId, this.diffs.idForPath(this.relativePath(path)));
    }
    return true;
  }

  /**
   * Switches a diff's tab to the file it compares.
   * @param diffId The diff tab's panel identifier.
   * @returns Returns true once the file is showing.
   */
  private async toFile(diffId: string): Promise<boolean> {
    const path: string | null = this.absolutePath(this.diffs.get(diffId));
    const well: StackNode | null = findStackOfPanel(this.dockState.layout(), diffId);
    if (path === null || well === null) {
      return false;
    }
    const wasOpen: boolean = this.documents.findIdByPath(path) !== undefined;
    if (!(await this.injector.get(FileOpener).openPath(path))) {
      return false;
    }
    const fileId: string | undefined = this.documents.findIdByPath(path);
    if (fileId === undefined) {
      return false;
    }
    if (this.settings.documentDiffSwitch() === 'swap') {
      this.replace(diffId, fileId);
    } else if (!wasOpen) {
      // A file the switch opened belongs beside the diff it came from, not in whichever well the
      // opener reaches first; one already open elsewhere is simply gone to, where it is.
      const index: number = this.indexIn(well.id, diffId);
      this.place(fileId, well.id, index + 1);
    }
    return true;
  }

  /**
   * Puts one tab where another stands and closes the other, so the tab reads as having turned into
   * the new view.
   * @param leavingId The tab being replaced, already cleared to close.
   * @param arrivingId The tab replacing it, already open.
   */
  private replace(leavingId: string, arrivingId: string): void {
    const stack: StackNode | null = findStackOfPanel(this.dockState.layout(), leavingId);
    if (stack === null) {
      return;
    }
    this.place(arrivingId, stack.id, stack.panels.indexOf(leavingId));
    this.dockState.removeFromLayout(leavingId);
  }

  /**
   * Moves a tab to a position in a stack and activates it there.
   * @param panelId The tab to move.
   * @param stackId The stack to move it into.
   * @param index The position it should take.
   */
  private place(panelId: string, stackId: string, index: number): void {
    const current: StackNode | null = findStackOfPanel(this.dockState.layout(), panelId);
    if (current === null) {
      return;
    }
    if (current.id === stackId) {
      this.dockState.reorderTab(stackId, current.panels.indexOf(panelId), index);
    } else {
      this.dockState.movePanel(panelId, stackId, index);
    }
    this.dockState.setActive(stackId, panelId);
  }

  /**
   * Gets a tab's position in a stack.
   * @param stackId The stack.
   * @param panelId The tab.
   * @returns Returns the position, or -1 when the tab is not there.
   */
  private indexIn(stackId: string, panelId: string): number {
    const stack: StackNode | null = findStackOfPanel(this.dockState.layout(), panelId);
    return stack?.id === stackId ? stack.panels.indexOf(panelId) : -1;
  }

  /**
   * Gets the absolute path of the file a change compares.
   * @param change The change, or null.
   * @returns Returns the path, or null when there is no change or no bound repository.
   */
  private absolutePath(change: GitFileChange | null): string | null {
    const root: string | undefined = this.repository.info()?.root;
    return change === null || root === undefined
      ? null
      : `${root.replace(/[\\/]+$/, '')}/${change.path}`;
  }

  /**
   * Gets a path relative to the repository root, with forward slashes — the form diff ids are made
   * from.
   * @param path The absolute path.
   * @returns Returns the relative path, or the path unchanged when it is outside the root.
   */
  private relativePath(path: string): string {
    const root: string = (this.repository.info()?.root ?? '').replace(/\\/g, '/');
    const slashed: string = path.replace(/\\/g, '/');
    return root.length > 0 && slashed.startsWith(`${root}/`)
      ? slashed.slice(root.length + 1)
      : slashed;
  }
}
