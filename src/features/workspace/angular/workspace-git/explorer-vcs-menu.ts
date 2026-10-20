import { inject, Service } from '@angular/core';
import { WorkspaceGit } from '@features/workspace/angular/workspace-git/workspace-git';
import { WorkspaceSourceControlCommands } from '@features/workspace/angular/workspace-source-control-commands/workspace-source-control-commands';
import { Icon } from '@shared/angular/icons/icon';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { DiffOpener } from '@shared/angular/services/diffs/diff-opener';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { MutationResult } from '@shared/angular/services/source-control/source-control-provider';

/**
 * Identifies the version-control commands an explorer row offers.
 */
const ACTION_SHOW_DIFF: string = 'show-diff';
const ACTION_REVERT: string = 'revert-changes';
const ACTION_ADD_TO_VCS: string = 'add-to-version-control';
const ACTION_UNDO_ADD: string = 'undo-add';
const ACTION_MARK_RESOLVED: string = 'mark-resolved';
const ACTION_OPEN_IN_REPOSITORY: string = 'open-in-repository';

/**
 * The row a version-control command is offered on or run against.
 */
export interface ExplorerVcsTarget {
  /**
   * Gets the row's absolute path.
   */
  readonly path: string;

  /**
   * Gets the row's name, as the user reads it — what a confirmation or a failure names.
   */
  readonly name: string;

  /**
   * Gets whether the row is a file or a folder: a folder has no diff and nothing of its own to add
   * back, but its edited files can be reverted together.
   */
  readonly kind: 'file' | 'directory';
}

/**
 * Builds and runs the version-control commands of the File and Solution Explorers' row menus (#1041),
 * so the two explorers offer the same commands, worded the same, and cannot drift apart.
 *
 * What a row offers follows from how version control sees it — a path is in exactly one state, so a
 * row shows at most two or three of these:
 *
 * - untracked: Add to Version Control
 * - added: Undo Add
 * - modified: Show Differences, Revert Changes
 * - conflicted: Mark Resolved, Open in Repository
 * - a folder with edited files beneath it: Revert Changes
 *
 * Scoped per directory tab, beside the {@link WorkspaceGit} it reads.
 */
@Service()
export class ExplorerVcsMenu {
  /**
   * Holds the workspace's version-control status and the writes the commands make.
   */
  private readonly git: WorkspaceGit = inject(WorkspaceGit);

  /**
   * Holds the opener a modified file's diff opens through, into this workspace's well.
   */
  private readonly diffOpener: DiffOpener = inject(DiffOpener);

  /**
   * Holds the file system service whose confirmation Revert asks first.
   */
  private readonly fileSystem: FileSystem = inject(FileSystem);

  /**
   * Holds the notification service a command that did not go through is reported to.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the route to the Repository panel, where a conflict is resolved.
   */
  private readonly sourceControl: WorkspaceSourceControlCommands = inject(
    WorkspaceSourceControlCommands,
  );

  /**
   * Gets the version-control commands a row offers, or none when nothing applies.
   * @param target The row.
   * @returns Returns the items, without a separator — the explorer places them.
   */
  public itemsFor(target: ExplorerVcsTarget): readonly MenuItem[] {
    const { path, kind } = target;
    const items: MenuItem[] = [];
    // Offered only on a path version control does not track yet: nothing is added unasked (#860).
    if (this.git.canAddToVersionControl(path)) {
      items.push({
        id: ACTION_ADD_TO_VCS,
        label: 'Add to Version Control',
        icon: Icon.PLUS_CIRCLE,
      });
    }
    if (kind === 'file' && this.git.canUndoAdd(path)) {
      items.push({ id: ACTION_UNDO_ADD, label: 'Undo Add', icon: Icon.MINUS_CIRCLE });
    }
    if (kind === 'file' && this.git.canShowDiff(path)) {
      items.push({ id: ACTION_SHOW_DIFF, label: 'Show Differences', icon: Icon.GIT_DIFF });
    }
    if (this.git.revertableFiles(path).length > 0) {
      items.push({ id: ACTION_REVERT, label: 'Revert Changes', icon: Icon.UNDO });
    }
    if (kind === 'file' && this.git.isConflicted(path)) {
      items.push(
        { id: ACTION_MARK_RESOLVED, label: 'Mark Resolved', icon: Icon.CHECK },
        { id: ACTION_OPEN_IN_REPOSITORY, label: 'Open in Repository', icon: Icon.SOURCE_CONTROL },
      );
    }
    return items;
  }

  /**
   * Runs a version-control command chosen from a row's menu.
   * @param itemId The chosen item's id.
   * @param target The row it was chosen for.
   * @returns Returns true when the id was one of these commands, false when the explorer should
   * handle it.
   */
  public run(itemId: string, target: ExplorerVcsTarget): boolean {
    switch (itemId) {
      case ACTION_ADD_TO_VCS:
        void this.report(
          this.git.addToVersionControl(target.path),
          `Could not add “${target.name}” to version control`,
        );
        return true;
      case ACTION_UNDO_ADD:
        void this.report(this.git.undoAdd(target.path), `Could not undo adding “${target.name}”`);
        return true;
      case ACTION_SHOW_DIFF:
        void this.showDiff(target);
        return true;
      case ACTION_REVERT:
        void this.revert(target);
        return true;
      case ACTION_MARK_RESOLVED:
        void this.report(
          this.git.markResolved(target.path),
          `Could not mark “${target.name}” resolved`,
        );
        return true;
      case ACTION_OPEN_IN_REPOSITORY:
        this.sourceControl.openInSourceControl();
        return true;
      default:
        return false;
    }
  }

  /**
   * Opens a modified file's diff, saying so when there is none to show.
   * @param target The row.
   */
  private async showDiff(target: ExplorerVcsTarget): Promise<void> {
    const refusal: string | null = await this.diffOpener.openPath(target.path);
    if (refusal !== null) {
      this.notifications.notify({
        severity: 'warning',
        title: `No diff for “${target.name}”`,
        detail: refusal,
      });
    }
  }

  /**
   * Takes a file, or every edited file in a folder, back to the last commit — once the user has said
   * so, since the edits cannot be recovered.
   * @param target The row.
   */
  private async revert(target: ExplorerVcsTarget): Promise<void> {
    const files: readonly string[] = this.git.revertableFiles(target.path);
    if (files.length === 0) {
      return;
    }
    const confirmed: boolean = await this.fileSystem.confirmDestructive({
      title: 'Revert Changes',
      message:
        target.kind === 'file'
          ? `Revert the changes to “${target.name}”?`
          : `Revert the changes to ${files.length === 1 ? '1 file' : `${files.length} files`} in “${target.name}”?`,
      detail:
        target.kind === 'file'
          ? 'The file goes back to how it was at the last commit. This cannot be undone.'
          : 'Each edited file goes back to how it was at the last commit; new files are left ' +
            'alone. This cannot be undone.',
      confirmLabel: 'Revert',
    });
    if (confirmed) {
      await this.report(this.git.revert(files), `Could not revert “${target.name}”`);
    }
  }

  /**
   * Reports a version-control write that did not go through.
   * @param pending The write.
   * @param title What the notification says did not happen.
   * @returns Returns a promise that settles once the write has.
   */
  private async report(pending: Promise<MutationResult>, title: string): Promise<void> {
    const result: MutationResult = await pending;
    if (!result.success) {
      this.notifications.notify({
        severity: 'error',
        title,
        detail: result.error ?? 'Version control refused it.',
      });
    }
  }
}
