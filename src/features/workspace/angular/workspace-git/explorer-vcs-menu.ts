import { inject, Service } from '@angular/core';
import { WorkspaceGit } from '@features/workspace/angular/workspace-git/workspace-git';
import { WorkspaceSourceControlCommands } from '@features/workspace/angular/workspace-source-control-commands/workspace-source-control-commands';
import { Icon } from '@shared/angular/icons/icon';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { DiffOpener } from '@shared/angular/services/diffs/diff-opener';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { Repository } from '@shared/angular/services/repository/repository';
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
const ACTION_IGNORE: string = 'ignore';
const ACTION_IGNORE_EXTENSION: string = 'ignore-extension';
const ACTION_STOP_TRACKING: string = 'stop-tracking';
const ACTION_SHOW_HISTORY: string = 'show-history';

/**
 * Matches an extension Ignore can offer to ignore everywhere — the same shape the protocol accepts.
 */
const EXTENSION_PATTERN: RegExp = /^[A-Za-z0-9_+-]+$/;

/**
 * Gets the extension of a file's name, without the dot, or null when it has none worth offering: no
 * dot, a dotfile's leading dot (`.env` is a name, not an extension), or characters a rule cannot hold.
 * @param name The file's name.
 * @returns Returns the extension, or null.
 */
function extensionOf(name: string): string | null {
  const dot: number = name.lastIndexOf('.');
  const extension: string = dot > 0 ? name.slice(dot + 1) : '';
  return EXTENSION_PATTERN.test(extension) ? extension : null;
}

/**
 * Gets the extension every row shares, when they are all files with the same one — what Ignore can
 * offer to ignore everywhere.
 * @param targets The rows.
 * @returns Returns the extension, without the dot, or null.
 */
function sharedExtension(targets: readonly ExplorerVcsTarget[]): string | null {
  const extensions: ReadonlySet<string | null> = new Set<string | null>(
    targets.map((target: ExplorerVcsTarget): string | null =>
      target.kind === 'file' ? extensionOf(target.name) : null,
    ),
  );
  const [only]: (string | null)[] = [...extensions];
  return extensions.size === 1 ? (only ?? null) : null;
}

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
 * - untracked: Add to Version Control, Ignore
 * - added: Undo Add
 * - unchanged: Show History, Stop Tracking
 * - modified: Show Differences, Show History, Revert Changes, Stop Tracking
 * - conflicted: Mark Resolved, Open in Repository, Show History
 * - a folder with edited files beneath it: Show History, Revert Changes, Stop Tracking
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
   * Holds this workspace's repository, whose history Show History narrows to a path.
   */
  private readonly repository: Repository = inject(Repository);

  /**
   * Holds the route to the Repository panel, where a conflict is resolved and a history shown.
   */
  private readonly sourceControl: WorkspaceSourceControlCommands = inject(
    WorkspaceSourceControlCommands,
  );

  /**
   * Gets the version-control commands a row offers — or, for several selected rows (#1048), those that
   * apply to every one of them — or none when nothing applies.
   *
   * A selection gets only what can act on all of it at once: the commands that need one file of their
   * own (Show Differences, Show History, Open in Repository) are left out rather than offered for the
   * first, and a command one row cannot take is not offered for any.
   * @param targets The row, or the selected rows.
   * @returns Returns the items, without a separator — the explorer places them.
   */
  public itemsFor(targets: readonly ExplorerVcsTarget[]): readonly MenuItem[] {
    if (targets.length === 0) {
      return [];
    }
    const single: ExplorerVcsTarget | null = targets.length === 1 ? targets[0] : null;
    const every: (test: (target: ExplorerVcsTarget) => boolean) => boolean = (
      test: (target: ExplorerVcsTarget) => boolean,
    ): boolean => targets.every(test);
    const files: boolean = every((target: ExplorerVcsTarget): boolean => target.kind === 'file');
    const items: MenuItem[] = [];
    // Offered only on a path version control does not track yet: nothing is added unasked (#860).
    if (
      every((target: ExplorerVcsTarget): boolean => this.git.canAddToVersionControl(target.path))
    ) {
      items.push({
        id: ACTION_ADD_TO_VCS,
        label: 'Add to Version Control',
        icon: Icon.PLUS_CIRCLE,
      });
    }
    if (every((target: ExplorerVcsTarget): boolean => this.git.canIgnore(target.path))) {
      items.push(this.ignoreItem(targets));
    }
    if (files && every((target: ExplorerVcsTarget): boolean => this.git.canUndoAdd(target.path))) {
      items.push({ id: ACTION_UNDO_ADD, label: 'Undo Add', icon: Icon.MINUS_CIRCLE });
    }
    if (single?.kind === 'file' && this.git.canShowDiff(single.path)) {
      items.push({ id: ACTION_SHOW_DIFF, label: 'Show Differences', icon: Icon.GIT_DIFF });
    }
    if (single !== null && this.git.historyPathOf(single.path) !== null) {
      items.push({ id: ACTION_SHOW_HISTORY, label: 'Show History', icon: Icon.GIT_HISTORY });
    }
    if (
      every(
        (target: ExplorerVcsTarget): boolean => this.git.revertableFiles(target.path).length > 0,
      )
    ) {
      items.push({ id: ACTION_REVERT, label: 'Revert Changes', icon: Icon.UNDO });
    }
    if (every((target: ExplorerVcsTarget): boolean => this.git.canStopTracking(target.path))) {
      items.push({
        id: ACTION_STOP_TRACKING,
        label: 'Stop Tracking',
        icon: Icon.GIT_STOP_TRACKING,
      });
    }
    if (
      files &&
      every((target: ExplorerVcsTarget): boolean => this.git.isConflicted(target.path))
    ) {
      items.push({ id: ACTION_MARK_RESOLVED, label: 'Mark Resolved', icon: Icon.CHECK });
      if (single !== null) {
        items.push({
          id: ACTION_OPEN_IN_REPOSITORY,
          label: 'Open in Repository',
          icon: Icon.SOURCE_CONTROL,
        });
      }
    }
    return items;
  }

  /**
   * Runs a version-control command chosen from a row's menu, on that row or on every selected row —
   * one request for them all.
   * @param itemId The chosen item's id.
   * @param targets The row, or the selected rows, it was chosen for.
   * @returns Returns true when the id was one of these commands, false when the explorer should
   * handle it.
   */
  public run(itemId: string, targets: readonly ExplorerVcsTarget[]): boolean {
    const first: ExplorerVcsTarget | undefined = targets[0];
    if (first === undefined) {
      return false;
    }
    const paths: readonly string[] = targets.map(
      (target: ExplorerVcsTarget): string => target.path,
    );
    const named: string = targets.length === 1 ? `“${first.name}”` : `${targets.length} items`;
    switch (itemId) {
      case ACTION_ADD_TO_VCS:
        void this.report(
          this.git.addToVersionControl(paths),
          `Could not add ${named} to version control`,
        );
        return true;
      case ACTION_UNDO_ADD:
        void this.report(this.git.undoAdd(paths), `Could not undo adding ${named}`);
        return true;
      case ACTION_SHOW_DIFF:
        void this.showDiff(first);
        return true;
      case ACTION_REVERT:
        void this.revert(targets);
        return true;
      case ACTION_MARK_RESOLVED:
        void this.report(this.git.markResolved(paths), `Could not mark ${named} resolved`);
        return true;
      case ACTION_OPEN_IN_REPOSITORY:
        this.sourceControl.openInSourceControl();
        return true;
      case ACTION_IGNORE:
        void this.report(this.git.ignore(paths), `Could not ignore ${named}`);
        return true;
      case ACTION_IGNORE_EXTENSION: {
        const extension: string | null = sharedExtension(targets);
        if (extension !== null) {
          void this.report(
            this.git.ignore([first.path], extension),
            `Could not ignore .${extension} files`,
          );
        }
        return true;
      }
      case ACTION_SHOW_HISTORY:
        void this.showHistory(first);
        return true;
      case ACTION_STOP_TRACKING:
        void this.report(this.git.stopTracking(paths), `Could not stop tracking ${named}`);
        return true;
      default:
        return false;
    }
  }

  /**
   * Builds the Ignore command: the rows themselves, or — when they are files sharing an extension — a
   * choice between them and every file with that extension.
   * @param targets The row, or the selected rows.
   * @returns Returns the item.
   */
  private ignoreItem(targets: readonly ExplorerVcsTarget[]): MenuItem {
    const extension: string | null = sharedExtension(targets);
    if (extension === null) {
      return { id: ACTION_IGNORE, label: 'Ignore', icon: Icon.GIT_IGNORE };
    }
    return {
      id: 'ignore-menu',
      label: 'Ignore',
      icon: Icon.GIT_IGNORE,
      children: [
        { id: ACTION_IGNORE, label: targets.length === 1 ? 'This File' : 'These Files' },
        { id: ACTION_IGNORE_EXTENSION, label: `All .${extension} Files` },
      ],
    };
  }

  /**
   * Narrows the Repository history to the row's path and brings the Repository view forward.
   * @param target The row.
   * @returns Returns a promise that settles once the history is read.
   */
  private async showHistory(target: ExplorerVcsTarget): Promise<void> {
    const path: string | null = this.git.historyPathOf(target.path);
    if (path === null) {
      return;
    }
    this.sourceControl.openInSourceControl();
    await this.repository.showHistoryOf(path);
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
   * Takes a file — or every edited file in the folders and files chosen — back to the last commit, once
   * the user has said so, since the edits cannot be recovered. The confirmation counts the files.
   * @param targets The row, or the selected rows.
   */
  private async revert(targets: readonly ExplorerVcsTarget[]): Promise<void> {
    const files: readonly string[] = [
      ...new Set<string>(
        targets.flatMap((target: ExplorerVcsTarget): readonly string[] =>
          this.git.revertableFiles(target.path),
        ),
      ),
    ];
    const first: ExplorerVcsTarget | undefined = targets[0];
    if (files.length === 0 || first === undefined) {
      return;
    }
    const count: string = files.length === 1 ? '1 file' : `${files.length} files`;
    const oneFile: boolean = targets.length === 1 && first.kind === 'file';
    const confirmed: boolean = await this.fileSystem.confirmDestructive({
      title: 'Revert Changes',
      message: oneFile
        ? `Revert the changes to “${first.name}”?`
        : targets.length === 1
          ? `Revert the changes to ${count} in “${first.name}”?`
          : `Revert the changes to ${count}?`,
      detail: oneFile
        ? 'The file goes back to how it was at the last commit. This cannot be undone.'
        : 'Each edited file goes back to how it was at the last commit; new files are left ' +
          'alone. This cannot be undone.',
      confirmLabel: 'Revert',
    });
    if (confirmed) {
      await this.report(
        this.git.revert(files),
        targets.length === 1 ? `Could not revert “${first.name}”` : `Could not revert ${count}`,
      );
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
