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
import { TreeRow, TreeView } from '@shared/angular/components/tree-view/tree-view';

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
 * Identifies the two working-tree groups.
 */
type WorkingGroup = 'tracked' | 'untracked';

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
 */
@Component({
  selector: 'app-commit-detail',
  imports: [AppIcon, Checkbox, TreeView],
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
  protected onWorkingRowClick(row: TreeRow): void {
    const entry: WorkingRowData = this.workingRowOf(row);
    if (entry.kind === 'group') {
      if (entry.group === 'tracked') {
        this.trackedExpanded.set(!this.trackedExpanded());
      } else {
        this.untrackedExpanded.set(!this.untrackedExpanded());
      }
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
   * @param event The textarea input event.
   */
  protected onMessageInput(event: Event): void {
    this.repository.setCommitMessage((event.target as HTMLTextAreaElement).value);
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
