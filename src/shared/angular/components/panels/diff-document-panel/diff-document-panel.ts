import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  EffectCleanupRegisterFn,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { findStackOfPanel } from '@shared/angular/services/dock-layout/dock-tree';
import { DocumentStatus } from '@shared/angular/services/document-status/document-status';
import { Diffs } from '@shared/angular/services/diffs/diffs';
import {
  GitChangeStatus,
  GitFileChange,
} from '@shared/angular/services/repository/repository-data';
import { ChipTone } from '@shared/angular/components/chip/chip';
import { StatusChip } from '@shared/angular/services/document-status/document-status';
import { Icon } from '@shared/angular/icons/icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { DiffSummary } from '@shared/angular/components/diff-editor/diff-editor';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { DiffView } from '../diff-view/diff-view';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { Menu, MenuItem } from '@shared/angular/components/menu/menu';
import { Repository } from '@shared/angular/services/repository/repository';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Editors, EditorLocation } from '@shared/angular/services/editors/editors';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { MutationResult } from '@shared/angular/services/source-control/source-control-provider';
import {
  DocumentFileCommands,
  injectDocumentFileCommands,
} from '@shared/angular/services/document-file-commands/document-file-commands';

/**
 * How long to wait between looks for a just-opened file's editor, so its caret can be placed.
 */
const REVEAL_POLL_MS: number = 80;

/**
 * How many looks before leaving the file open at its start.
 */
const REVEAL_POLL_ATTEMPTS: number = 25;

/**
 * Hosts a changed file's diff inside the source-control document well. The dock panel id is the diff
 * id; this resolves the {@link GitFileChange} for it from the {@link Diffs} store and projects the
 * shared {@link DiffView}. The dock keeps every well panel mounted, so the Monaco diff survives tab
 * switches and relays out on show through its automatic layout.
 *
 * The panel owns its tool strip (`ownsToolStrip`), which is why the dock's stubbed editor tools no
 * longer appear above it: a diff is not a text editor, and Split Editor and Find in File were
 * offering things this tab cannot do. What it can do is change how the comparison is laid out and
 * walk the changes, so that is what the strip carries.
 */
@Component({
  selector: 'app-diff-document-panel',
  imports: [Button, CdkMenuTrigger, DiffView, Dropdown, Menu, PanelToolbar],
  templateUrl: './diff-document-panel.html',
  styleUrl: './diff-document-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiffDocumentPanel {
  /**
   * Gets the dock panel descriptor; its id is the diff id this panel hosts.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the diff content store the hosted diff is resolved from.
   */
  private readonly diffs: Diffs = inject(Diffs);

  /**
   * Holds the dock layout, which says whether this tab is the one being looked at.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the well status strip this tab publishes its comparison summary to.
   */
  private readonly documentStatus: DocumentStatus = inject(DocumentStatus);

  /**
   * Gets the icon set, for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the file change this panel compares, or null when it is no longer open.
   */
  protected readonly file: Signal<GitFileChange | null> = computed((): GitFileChange | null =>
    this.diffs.get(this.panel().id),
  );

  /**
   * Gets whether there is a comparison to act on, which gates the navigation arrows.
   */
  protected readonly hasFile: Signal<boolean> = computed((): boolean => this.file() !== null);

  /**
   * Holds the workspace's repository, which stages, unstages and discards a working-tree change, or
   * null where there is none.
   */
  private readonly repository: Repository | null = inject(Repository, { optional: true });

  /**
   * Holds the file opener, for Open File.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Holds the editor registry, used to place the caret in the file Open File opens.
   */
  private readonly editors: Editors = inject(Editors);

  /**
   * Holds the file system, whose confirmation guards Discard Changes.
   */
  private readonly fileSystem: FileSystem = inject(FileSystem);

  /**
   * Holds the file commands the strip's menu offers, shared with every document strip (#882).
   */
  private readonly fileCommands: DocumentFileCommands = injectDocumentFileCommands();

  /**
   * Holds whether a stage, unstage or discard is under way, during which none runs another.
   */
  protected readonly busy: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the compared file's absolute path, or null when there is no file or no repository root.
   */
  protected readonly absolutePath: Signal<string | null> = computed((): string | null => {
    const file: GitFileChange | null = this.file();
    const root: string | undefined = this.repository?.info()?.root;
    return file === null || root === undefined
      ? null
      : `${root.replace(/[\\/]+$/, '')}/${file.path}`;
  });

  /**
   * Gets whether the diff is of a working-tree change — what can be staged, unstaged or discarded; a
   * commit's diff is history, and none of them applies to it.
   */
  protected readonly isWorkingChange: Signal<boolean> = computed(
    (): boolean => this.file()?.target?.kind === 'working' && this.repository !== null,
  );

  /**
   * Gets whether the diff is of a staged change, so the strip offers Unstage rather than Stage.
   */
  protected readonly isStaged: Signal<boolean> = computed((): boolean => {
    const target: GitFileChange['target'] = this.file()?.target;
    return target?.kind === 'working' && target.staged;
  });

  /**
   * Gets whether Open File can open the file: there is one, and it was not deleted.
   */
  protected readonly canOpenFile: Signal<boolean> = computed(
    (): boolean => this.absolutePath() !== null && this.file()?.status !== 'deleted',
  );

  /**
   * Gets the strip menu's items: the file's own commands.
   */
  protected readonly menuItems: Signal<readonly MenuItem[]> = computed((): readonly MenuItem[] =>
    this.fileCommands.items(this.absolutePath()),
  );

  /**
   * Gets whether the diff renders inline rather than side by side.
   */
  protected readonly inline: Signal<boolean> = this.diffs.inlineDiff;

  /**
   * The layouts the diff can be read in. Named rather than toggled: a control offering both choices
   * should say which one is in force without the user pressing it to find out.
   */
  protected readonly layoutOptions: readonly DropdownOption[] = [
    { value: 'side-by-side', label: 'Side by side' },
    { value: 'inline', label: 'Inline' },
  ];

  /**
   * Holds the projected diff view, which owns the Monaco editor the arrows drive.
   */
  private readonly view: Signal<DiffView | undefined> = viewChild<DiffView>(DiffView);

  /**
   * Gets whether this panel is the active tab of the stack it sits in.
   *
   * Asked of the layout rather than taken as an input, because the dock's outlet binds only the panel
   * descriptor. It has to be asked at all: the well keeps every tab mounted, so several diffs are
   * alive at once and each would otherwise publish over the last.
   */
  private readonly isActive: Signal<boolean> = computed((): boolean => {
    const id: string = this.panel().id;
    return findStackOfPanel(this.dockState.layout(), id)?.active === id;
  });

  /**
   * Holds the summary Monaco last computed, republished whenever the diff or the caret moves.
   */
  private readonly summary: WritableSignal<DiffSummary | null> = signal<DiffSummary | null>(null);

  /**
   * Subscribes to the pane's diff, and publishes this tab's status to the well strip while it is the
   * active one.
   */
  public constructor() {
    const destroyRef: DestroyRef = inject(DestroyRef);

    // The view arrives with the projected content, and only when there is a file to compare.
    effect((onCleanup: EffectCleanupRegisterFn): void => {
      const view: DiffView | undefined = this.view();
      if (view === undefined) {
        this.summary.set(null);
        return;
      }
      const read: () => void = (): void => this.summary.set(view.getDiffSummary());
      read();
      onCleanup(view.onDiffChanged(read));
    });

    effect((): void => {
      const file: GitFileChange | null = this.file();
      const summary: DiffSummary | null = this.summary();
      if (!this.isActive() || file === null) {
        this.documentStatus.clear(this.panel().id);
        return;
      }
      this.documentStatus.set(this.panel().id, {
        chip: changeChip(file.status),
        language: file.language,
        changes: summary?.changes ?? 0,
        ...(summary?.currentChange === undefined ? {} : { currentChange: summary.currentChange }),
        linesAdded: summary?.linesAdded ?? 0,
        linesRemoved: summary?.linesRemoved ?? 0,
      });
    });

    destroyRef.onDestroy((): void => {
      this.documentStatus.clear(this.panel().id);
    });
  }

  /**
   * Applies the layout chosen from the dropdown, for every open diff.
   * @param value The chosen layout.
   */
  protected onLayoutChange(value: string): void {
    this.diffs.setInline(value === 'inline');
  }

  /**
   * Moves to the previous change in the file.
   */
  protected previousChange(): void {
    this.view()?.goToDiff('previous');
  }

  /**
   * Moves to the next change in the file.
   */
  protected nextChange(): void {
    this.view()?.goToDiff('next');
  }

  /**
   * Opens the compared file to edit, with the caret where it is on the diff's changed side.
   */
  protected async openFile(): Promise<void> {
    const path: string | null = this.absolutePath();
    if (path === null || !this.canOpenFile()) {
      return;
    }
    const position: { readonly line: number; readonly column: number } | null =
      this.view()?.modifiedPosition() ?? null;
    if (!(await this.fileOpener.openPath(path)) || position === null) {
      return;
    }
    for (let attempt: number = 0; attempt < REVEAL_POLL_ATTEMPTS; attempt++) {
      const modelUri: string | undefined = this.editors.modelUriForPath(path);
      const location: EditorLocation | undefined =
        modelUri === undefined ? undefined : this.editors.locate(modelUri);
      if (location !== undefined) {
        this.editors.requestReveal(location.documentId, position.line, position.column);
        return;
      }
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, REVEAL_POLL_MS);
      });
    }
  }

  /**
   * Stages the change, or unstages it when it is staged, and shows what it then is.
   */
  protected async toggleStaged(): Promise<void> {
    const file: GitFileChange | null = this.file();
    if (file === null || this.repository === null || !this.isWorkingChange() || this.busy()) {
      return;
    }
    const staged: boolean = this.isStaged();
    await this.mutate(
      (): Promise<MutationResult> =>
        staged ? this.repository!.unstage(file) : this.repository!.stage(file),
      // Staged, the change is the index's; unstaged, the working tree's. A file partly staged is in
      // both lists, and the one it moved to is the one to show.
      (): GitFileChange | undefined =>
        (staged ? this.repository!.unstaged() : this.repository!.staged()).find(
          (change: GitFileChange): boolean => change.path === file.path,
        ),
    );
  }

  /**
   * Discards the change, once confirmed — a tracked file goes back to the last commit, an untracked
   * one is deleted — and closes the diff, which then has nothing to compare.
   */
  protected async discard(): Promise<void> {
    const file: GitFileChange | null = this.file();
    if (file === null || this.repository === null || !this.isWorkingChange() || this.isStaged()) {
      return;
    }
    const confirmed: boolean = await this.fileSystem.confirmDestructive({
      title: 'Discard Changes',
      message: `Discard the changes to "${file.path}"?`,
      detail:
        'A tracked file is restored to the last commit; an untracked file is deleted. ' +
        'This cannot be undone.',
      confirmLabel: 'Discard',
    });
    if (!confirmed) {
      return;
    }
    await this.mutate(
      (): Promise<MutationResult> => this.repository!.discard(file),
      (): GitFileChange | undefined => undefined,
    );
  }

  /**
   * Runs a command chosen from the strip's menu.
   * @param id The chosen item's identifier.
   */
  protected onMenu(id: string): void {
    this.fileCommands.run(id, this.absolutePath());
  }

  /**
   * Runs a change to the repository and then shows what the file has become: its change as it now
   * stands, read afresh, or — when it no longer has one there — closes the diff.
   * @param change Makes the change.
   * @param next Finds the file's change afterwards, once the repository has refreshed.
   */
  private async mutate(
    change: () => Promise<MutationResult>,
    next: () => GitFileChange | undefined,
  ): Promise<void> {
    this.busy.set(true);
    try {
      const result: MutationResult = await change();
      if (!result.success) {
        return;
      }
      const updated: GitFileChange | undefined = next();
      const id: string = this.panel().id;
      if (updated === undefined) {
        this.dockState.removeFromLayout(id);
        return;
      }
      this.diffs.put(id, updated);
      const diff: { original: string; modified: string } = await this.repository!.loadDiff(updated);
      this.diffs.put(id, { ...updated, original: diff.original, modified: diff.modified });
    } finally {
      this.busy.set(false);
    }
  }
}

/**
 * Builds the status chip for how a file changed: green for a file added, amber for one modified, red
 * for one deleted, the accent for one renamed, and red again for one in conflict.
 * @param status How the file changed.
 * @returns Returns the chip.
 */
function changeChip(status: GitChangeStatus): StatusChip {
  const tones: Readonly<Record<GitChangeStatus, ChipTone>> = {
    added: 'success',
    modified: 'warning',
    deleted: 'danger',
    renamed: 'accent',
    conflicted: 'danger',
  };
  return {
    text: status.charAt(0).toUpperCase() + status.slice(1),
    tone: tones[status],
    title: 'How the file changed',
  };
}
