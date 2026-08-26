import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { GitOperationKind, GitOperationState } from '@shared/api/source-control-channels';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { DiffOpener } from '@shared/angular/services/diffs/diff-opener';
import { CommitMessageGenerator } from '@shared/angular/services/repository/commit-message-generator';
import { Repository } from '@shared/angular/services/repository/repository';
import {
  GitChangeStatus,
  GitFileChange,
} from '@shared/angular/services/repository/repository-data';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { TreeRow, TreeView } from '@shared/angular/components/tree-view/tree-view';
import { Button } from '@shared/angular/components/forms/button/button';
import { Textarea } from '@shared/angular/components/forms/textarea/textarea';

/**
 * Summarises a file group's checkbox state: fully checked, and partially checked (mixed).
 */
interface GroupCheckState {
  /**
   * Gets a value indicating whether every file in the group is checked.
   */
  readonly all: boolean;

  /**
   * Gets a value indicating whether only some files in the group are checked.
   */
  readonly mixed: boolean;
}

/**
 * Identifies the working-tree groups. `conflicted` leads, when there is one: it is the group that
 * has to be dealt with before anything else in the tree can be committed at all.
 */
type WorkingGroup = 'conflicted' | 'tracked' | 'untracked';

/**
 * How each operation reads in the mid-operation banner's title.
 */
const OPERATION_TITLES: Readonly<Record<GitOperationKind, string>> = {
  merge: 'Merging',
  'squash-merge': 'Squash merging',
  rebase: 'Rebasing',
  'cherry-pick': 'Cherry-picking',
  revert: 'Reverting',
};

/**
 * The payload a working-tree row carries: a group header, or one changed file.
 */
type WorkingRowData =
  | { readonly kind: 'group'; readonly group: WorkingGroup }
  | { readonly kind: 'file'; readonly file: GitFileChange };

/**
 * Renders the source-control view's commit pane: metadata for the selected commit above its changed
 * files, or — when the working tree is selected — the commit composer. The composer groups the
 * working tree into Tracked Files and Untracked Files, each with a tri-state group checkbox and
 * per-file checkboxes that pick exactly what the commit will contain (checked untracked files are
 * added on commit), above a boxed commit-message editor with AI-assisted message generation and
 * Commit / Commit and Push actions. Selecting a file drives the repository's file selection, which
 * the Monaco diff surface follows.
 *
 * The panel owns its tool strip, per the ribbon-versus-panel rule: Refresh, Discard All, Show Diff
 * and Stash act on what the panel holds, and Expand All / Collapse All act on its tree — the same
 * pair, on the same glyphs, that the Solution Explorer wears.
 *
 * Discard All deliberately acts on the WHOLE working tree, not the checked files — the checkboxes
 * pick what to commit, and destroying only part of the user's changes because of a commit-scoped
 * selection would be a trap — and it goes through the shared destructive confirmation.
 *
 * The diff-layout toggle used to live here and now sits on the diff panel itself. A diff's layout is
 * a property of the diff, and reaching for it meant finding a git panel that had nothing else to do
 * with it.
 */
@Component({
  selector: 'app-commit-detail',
  imports: [Textarea, Button, AppIcon, Checkbox, PanelToolbar, TreeView],
  templateUrl: './commit-detail.html',
  styleUrl: './commit-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitDetail {
  /**
   * Gets the dock panel descriptor this panel was projected for. Supplied by the dock outlet; the
   * pane reads its state from the shared {@link Repository} rather than the descriptor.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the repository model the pane renders.
   */
  protected readonly repository: Repository = inject(Repository);

  /**
   * Holds the AI commit-message generator behind the composer's sparkle affordance.
   */
  protected readonly generator: CommitMessageGenerator = inject(CommitMessageGenerator);

  /**
   * Holds the diff opener that surfaces a selected file's diff in the document well.
   */
  private readonly diffOpener: DiffOpener = inject(DiffOpener);

  /**
   * Holds the file-system service showing the destructive-discard confirmation dialog.
   */
  private readonly fileSystem: FileSystem = inject(FileSystem);

  /**
   * Gets or sets whether the Tracked Files group is expanded.
   */
  protected readonly trackedExpanded: WritableSignal<boolean> = signal<boolean>(true);

  /**
   * Gets or sets whether the Untracked Files group is expanded.
   */
  protected readonly untrackedExpanded: WritableSignal<boolean> = signal<boolean>(true);

  /**
   * Gets or sets whether the Conflicted Files group is expanded.
   */
  protected readonly conflictedExpanded: WritableSignal<boolean> = signal<boolean>(true);

  /**
   * Holds the paths currently checked for inclusion in the next commit.
   */
  private readonly checkedSignal: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds every path that has appeared in the working tree so far, so the reconciliation effect can
   * tell a newly-appeared file (which gets its default check state) from one the user unchecked.
   */
  private readonly knownPaths: Set<string> = new Set<string>();

  /**
   * Gets the changes to tracked files: every staged and unstaged change except untracked entries,
   * one row per path (the working-tree side wins when a file is both staged and further edited).
   */
  protected readonly trackedFiles: Signal<readonly GitFileChange[]> = computed(
    (): readonly GitFileChange[] => {
      const merged: Map<string, GitFileChange> = new Map<string, GitFileChange>();
      for (const file of this.repository.staged()) {
        merged.set(file.path, file);
      }
      for (const file of this.repository.unstaged()) {
        if (file.untracked !== true) {
          merged.set(file.path, file);
        }
      }
      return [...merged.values()];
    },
  );

  /**
   * Gets the untracked files (new files git does not know yet).
   */
  protected readonly untrackedFiles: Signal<readonly GitFileChange[]> = computed(
    (): readonly GitFileChange[] =>
      this.repository.unstaged().filter((file: GitFileChange): boolean => file.untracked === true),
  );

  /**
   * Gets the paths left conflicted by an unfinished merge or rebase.
   */
  protected readonly conflictedFiles: Signal<readonly GitFileChange[]> = this.repository.conflicted;

  /**
   * Gets how the operation in flight is named, with what it is working towards.
   */
  protected readonly operationTitle: Signal<string> = computed((): string => {
    const state: GitOperationState = this.repository.operation();
    if (state.kind === null) {
      return '';
    }
    const verb: string = OPERATION_TITLES[state.kind];
    return state.target === undefined ? verb : `${verb} “${state.target}”`;
  });

  /**
   * Gets how far through a replayed operation this is, or null when it applies a single change and
   * has no progress to report.
   */
  protected readonly operationProgress: Signal<string | null> = computed((): string | null => {
    const state: GitOperationState = this.repository.operation();
    return state.step === undefined || state.total === undefined
      ? null
      : `${state.step} of ${state.total}`;
  });

  /**
   * Gets what the banner says to do next: resolve what is conflicted, or carry on now that nothing is.
   *
   * A squash merge is told apart, because it ends differently from everything else here: git recorded
   * no merge to resume, so the resolved result is committed from the composer below like any other
   * change, and a Continue that git would refuse is not what the user needs to be told about.
   */
  protected readonly operationMessage: Signal<string> = computed((): string => {
    const count: number = this.conflictedFiles().length;
    if (count > 0) {
      const files: string = count === 1 ? '1 file' : `${count} files`;
      return `${files} could not be merged automatically. Resolve each one, mark it resolved, then continue.`;
    }
    return this.repository.operation().kind === 'squash-merge'
      ? 'Nothing is left conflicted. The result is staged: commit it below to finish.'
      : 'Nothing is left conflicted. Continue to finish, or abort to put everything back.';
  });

  /**
   * Gets a value indicating whether skipping is on offer: only an operation that replays a sequence
   * of commits has a next one to move on to.
   */
  protected readonly canSkip: Signal<boolean> = computed((): boolean => {
    const kind: GitOperationKind | null = this.repository.operation().kind;
    return kind === 'rebase' || kind === 'cherry-pick';
  });

  /**
   * Gets the Tracked Files group's checkbox state.
   */
  protected readonly trackedState: Signal<GroupCheckState> = computed(
    (): GroupCheckState => this.groupState(this.trackedFiles()),
  );

  /**
   * Gets the Untracked Files group's checkbox state.
   */
  protected readonly untrackedState: Signal<GroupCheckState> = computed(
    (): GroupCheckState => this.groupState(this.untrackedFiles()),
  );

  /**
   * Gets the checked files, tracked first, in display order — exactly what the commit will contain.
   */
  protected readonly checkedFiles: Signal<readonly GitFileChange[]> = computed(
    (): readonly GitFileChange[] => {
      const checked: ReadonlySet<string> = this.checkedSignal();
      return [...this.trackedFiles(), ...this.untrackedFiles()].filter(
        (file: GitFileChange): boolean => checked.has(file.path),
      );
    },
  );

  /**
   * Gets a value indicating whether the commit actions are enabled: at least one file is checked and
   * the draft message is not blank.
   */
  protected readonly canCommit: Signal<boolean> = computed(
    (): boolean =>
      this.checkedFiles().length > 0 && this.repository.commitMessage().trim().length > 0,
  );

  /**
   * Gets a value indicating whether the AI message affordance is enabled: a bridge exists, no
   * generation is running, and there is something checked to describe.
   */
  protected readonly canGenerate: Signal<boolean> = computed(
    (): boolean =>
      this.generator.isAvailable && !this.generator.generating() && this.checkedFiles().length > 0,
  );

  /**
   * Gets the working-tree rows for the shared tree view: the Tracked Files and Untracked Files group
   * headers, each followed (while expanded) by its file rows.
   */
  protected readonly workingRows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] => {
    const rows: TreeRow[] = [];
    // The conflicted group appears only while there is something in it, and leads when it does:
    // nothing else in the working tree can be committed until it is empty.
    if (this.conflictedFiles().length > 0) {
      rows.push({
        id: 'group:conflicted',
        depth: 0,
        expandable: true,
        expanded: this.conflictedExpanded(),
        data: { kind: 'group', group: 'conflicted' } satisfies WorkingRowData,
      });
      if (this.conflictedExpanded()) {
        for (const file of this.conflictedFiles()) {
          rows.push({
            id: file.path,
            depth: 1,
            expandable: false,
            expanded: false,
            data: { kind: 'file', file } satisfies WorkingRowData,
          });
        }
      }
    }
    rows.push({
      id: 'group:tracked',
      depth: 0,
      expandable: true,
      expanded: this.trackedExpanded(),
      data: { kind: 'group', group: 'tracked' } satisfies WorkingRowData,
    });
    if (this.trackedExpanded()) {
      for (const file of this.trackedFiles()) {
        rows.push({
          id: file.path,
          depth: 1,
          expandable: false,
          expanded: false,
          data: { kind: 'file', file } satisfies WorkingRowData,
        });
      }
    }
    rows.push({
      id: 'group:untracked',
      depth: 0,
      expandable: true,
      expanded: this.untrackedExpanded(),
      data: { kind: 'group', group: 'untracked' } satisfies WorkingRowData,
    });
    if (this.untrackedExpanded()) {
      for (const file of this.untrackedFiles()) {
        rows.push({
          id: file.path,
          depth: 1,
          expandable: false,
          expanded: false,
          data: { kind: 'file', file } satisfies WorkingRowData,
        });
      }
    }
    return rows;
  });

  /**
   * Gets the selected commit's changed files as flat rows for the shared tree view.
   */
  protected readonly commitRows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] =>
    this.repository.selectedFiles().map(
      (file: GitFileChange): TreeRow => ({
        id: file.path,
        depth: 0,
        expandable: false,
        expanded: false,
        data: file,
      }),
    ),
  );

  /**
   * Initializes a new instance of the {@link CommitDetail} class, keeping the checked set in step
   * with the working tree: a still-present path keeps the user's choice, a newly-appeared tracked
   * file defaults to checked, a newly-appeared untracked file defaults to unchecked, and a vanished
   * path is dropped.
   */
  public constructor() {
    effect((): void => {
      const tracked: readonly GitFileChange[] = this.trackedFiles();
      const untracked: readonly GitFileChange[] = this.untrackedFiles();
      this.checkedSignal.update((current: ReadonlySet<string>): ReadonlySet<string> => {
        const next: Set<string> = new Set<string>();
        for (const file of tracked) {
          if (this.knownPaths.has(file.path) ? current.has(file.path) : true) {
            next.add(file.path);
          }
        }
        for (const file of untracked) {
          if (this.knownPaths.has(file.path) && current.has(file.path)) {
            next.add(file.path);
          }
        }
        for (const file of [...tracked, ...untracked]) {
          this.knownPaths.add(file.path);
        }
        return next;
      });
    });
  }

  /**
   * Gets whether a file is checked for inclusion in the next commit.
   * @param path The file's repository-relative path.
   * @returns Returns true when the file is checked.
   */
  protected isChecked(path: string): boolean {
    return this.checkedSignal().has(path);
  }

  /**
   * Checks or unchecks a single file.
   * @param file The file to update.
   * @param checked Whether the file is included in the next commit.
   */
  protected setFileChecked(file: GitFileChange, checked: boolean): void {
    this.checkedSignal.update((current: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set<string>(current);
      if (checked) {
        next.add(file.path);
      } else {
        next.delete(file.path);
      }
      return next;
    });
  }

  /**
   * Checks or unchecks every file in a group (the group checkbox).
   * @param files The group's files.
   * @param checked Whether the group is included in the next commit.
   */
  protected setGroupChecked(files: readonly GitFileChange[], checked: boolean): void {
    this.checkedSignal.update((current: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set<string>(current);
      for (const file of files) {
        if (checked) {
          next.add(file.path);
        } else {
          next.delete(file.path);
        }
      }
      return next;
    });
  }

  /**
   * Unwraps a working-tree row's payload.
   * @param row The tree row.
   * @returns Returns the row's group or file payload.
   */
  protected workingRowOf(row: TreeRow): WorkingRowData {
    return row.data as WorkingRowData;
  }

  /**
   * Unwraps a commit-files row's payload.
   * @param row The tree row.
   * @returns Returns the changed file.
   */
  protected fileOf(row: TreeRow): GitFileChange {
    return row.data as GitFileChange;
  }

  /**
   * Handles a click on a working-tree row: a group header toggles its expansion; a file row selects
   * the file and opens its diff.
   * @param row The clicked tree row.
   */
  /**
   * Resolves a group to the signal holding whether it is expanded.
   * @param group The group.
   * @returns Returns the group's expansion state.
   */
  private groupExpansion(group: WorkingGroup): WritableSignal<boolean> {
    switch (group) {
      case 'conflicted':
        return this.conflictedExpanded;
      case 'untracked':
        return this.untrackedExpanded;
      default:
        return this.trackedExpanded;
    }
  }

  /**
   * Gets a group's heading.
   * @param group The group.
   * @returns Returns the label.
   */
  protected groupLabel(group: WorkingGroup): string {
    switch (group) {
      case 'conflicted':
        return 'Conflicted Files';
      case 'untracked':
        return 'Untracked Files';
      default:
        return 'Tracked Files';
    }
  }

  /**
   * Gets a group's files.
   * @param group The group.
   * @returns Returns the files.
   */
  protected groupFiles(group: WorkingGroup): readonly GitFileChange[] {
    switch (group) {
      case 'conflicted':
        return this.conflictedFiles();
      case 'untracked':
        return this.untrackedFiles();
      default:
        return this.trackedFiles();
    }
  }

  /**
   * Marks a conflicted file resolved, which is what staging it means to git: the version now on disk
   * becomes the one it carries, and the path stops being unmerged.
   * @param file The conflicted file.
   */
  protected markResolved(file: GitFileChange): void {
    void this.repository.stage(file);
  }

  /**
   * Carries on the operation in flight.
   */
  protected continueOperation(): void {
    void this.repository.continueOperation();
  }

  /**
   * Skips the commit the operation in flight is stuck on.
   */
  protected skipOperation(): void {
    void this.repository.skipOperation();
  }

  /**
   * Abandons the operation in flight, putting the working tree back where it started.
   */
  protected abortOperation(): void {
    void this.repository.abortOperation();
  }

  protected onWorkingRowClick(row: TreeRow): void {
    const entry: WorkingRowData = this.workingRowOf(row);
    if (entry.kind === 'group') {
      this.groupExpansion(entry.group).update((open: boolean): boolean => !open);
      return;
    }
    this.selectFile(entry.file);
  }

  /**
   * Handles a click on a commit-files row: selects the file and opens its diff.
   * @param row The clicked tree row.
   */
  protected onCommitRowClick(row: TreeRow): void {
    this.selectFile(this.fileOf(row));
  }

  /**
   * Selects a changed file and opens its diff in the document well.
   * @param file The file to select.
   */
  protected selectFile(file: GitFileChange): void {
    this.repository.selectFile(file.path);
    this.diffOpener.open(file);
  }

  /**
   * Updates the draft commit message as the user types.
   * @param message The message typed into the composer.
   */
  protected onMessageValue(message: string): void {
    this.repository.setCommitMessage(message);
  }

  /**
   * Discards a file's uncommitted changes after an explicit confirmation — a tracked file is
   * restored to `HEAD`, an untracked one is deleted. The change cannot be recovered.
   * @param file The file whose changes are discarded.
   */
  protected async discard(file: GitFileChange): Promise<void> {
    const confirmed: boolean = await this.fileSystem.confirmDestructive({
      title: 'Discard Changes',
      message: `Discard the changes to "${file.path}"?`,
      detail:
        'A tracked file is restored to the last commit; an untracked file is deleted. ' +
        'This cannot be undone.',
      confirmLabel: 'Discard',
    });
    if (confirmed) {
      void this.repository.discard(file);
    }
  }

  /**
   * Gets the working-tree files the panel is showing, tracked first — what Discard All acts on.
   */
  protected readonly workingFiles: Signal<readonly GitFileChange[]> = computed(
    (): readonly GitFileChange[] => [...this.trackedFiles(), ...this.untrackedFiles()],
  );

  /**
   * Discards every uncommitted change in the working tree, after confirmation. Acts on the whole
   * working tree rather than the checked files: the checkboxes pick what to COMMIT, and quietly
   * destroying only some of the user's changes because of a commit-scoped selection would be a trap.
   */
  protected async discardAll(): Promise<void> {
    const files: readonly GitFileChange[] = this.workingFiles();
    if (files.length === 0) {
      return;
    }
    const confirmed: boolean = await this.fileSystem.confirmDestructive({
      title: 'Discard All Changes',
      message: `Discard the changes to all ${files.length} file(s) in the working tree?`,
      detail:
        'Tracked files are restored to the last commit; untracked files are deleted. ' +
        'This cannot be undone.',
      confirmLabel: 'Discard All',
    });
    if (confirmed) {
      void this.repository.discardFiles(files);
    }
  }

  /**
   * Re-reads the repository state.
   */
  protected refresh(): void {
    void this.repository.refresh();
  }

  /**
   * Opens the selected file's diff in the document well.
   *
   * Clicking a row already does this; the button is for the file that is selected but whose diff has
   * since been closed, where there is otherwise nothing to click but the row that is already current.
   */
  protected showDiff(): void {
    const file: GitFileChange | null = this.repository.selectedFile();
    if (file !== null) {
      this.diffOpener.open(file);
    }
  }

  /**
   * Stashes the uncommitted changes, putting them on the stack the Repository panel lists.
   */
  protected stash(): void {
    void this.repository.stash();
  }

  /**
   * Opens both file groups.
   */
  protected expandAll(): void {
    this.trackedExpanded.set(true);
    this.untrackedExpanded.set(true);
    this.conflictedExpanded.set(true);
  }

  /**
   * Closes both file groups.
   */
  protected collapseAll(): void {
    this.trackedExpanded.set(false);
    this.untrackedExpanded.set(false);
    this.conflictedExpanded.set(false);
  }

  /**
   * Clears the surfaced error from the most recent operation.
   */
  protected dismissError(): void {
    this.repository.dismissError();
  }

  /**
   * Commits exactly the checked files with the draft message.
   */
  protected commit(): void {
    void this.repository.commitFiles(this.checkedPaths());
  }

  /**
   * Commits exactly the checked files with the draft message, then pushes the current branch.
   */
  protected commitAndPush(): void {
    void this.repository.commitAndPushFiles(this.checkedPaths());
  }

  /**
   * Generates a draft commit message from the checked files, replacing the current draft when the
   * generation succeeds.
   */
  protected async generateMessage(): Promise<void> {
    const message: string | null = await this.generator.generate(this.checkedFiles());
    if (message !== null) {
      this.repository.setCommitMessage(message);
    }
  }

  /**
   * Gets the single-letter status badge for a change kind (A, M, D, R).
   * @param status The change kind.
   * @returns Returns the status letter.
   */
  protected statusLetter(status: GitChangeStatus): string {
    switch (status) {
      case 'added':
        return 'A';
      case 'deleted':
        return 'D';
      case 'renamed':
        return 'R';
      default:
        return 'M';
    }
  }

  /**
   * Gets the trailing file-name segment of a path, shown as the primary label.
   * @param path The full path.
   * @returns Returns the last path segment.
   */
  protected fileName(path: string): string {
    const segments: readonly string[] = path.split('/');
    return segments[segments.length - 1] ?? path;
  }

  /**
   * Gets the leading directory segment of a path, shown as a muted prefix.
   * @param path The full path.
   * @returns Returns the directory portion, or an empty string when the file is at the root.
   */
  protected fileDir(path: string): string {
    const index: number = path.lastIndexOf('/');
    return index === -1 ? '' : path.slice(0, index);
  }

  /**
   * Gets the checked files' paths, in display order.
   * @returns Returns the checked paths.
   */
  private checkedPaths(): readonly string[] {
    return this.checkedFiles().map((file: GitFileChange): string => file.path);
  }

  /**
   * Summarises a group's checkbox state from its files' checked membership.
   * @param files The group's files.
   * @returns Returns the group state.
   */
  private groupState(files: readonly GitFileChange[]): GroupCheckState {
    const checked: ReadonlySet<string> = this.checkedSignal();
    const count: number = files.filter((file: GitFileChange): boolean =>
      checked.has(file.path),
    ).length;
    return {
      all: files.length > 0 && count === files.length,
      mixed: count > 0 && count < files.length,
    };
  }
}
