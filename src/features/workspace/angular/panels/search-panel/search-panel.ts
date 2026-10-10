import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  InputSignal,
  OnDestroy,
  signal,
  Signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Chip } from '@shared/angular/components/chip/chip';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { TreeRow, TreeView } from '@shared/angular/components/tree-view/tree-view';
import { fileIconFor } from '@shared/angular/icons/file-icon';
import { FindQuery, FindResultItem } from '@shared/angular/components/find-panel/find-adapter';
import { WorkspaceSearchAdapter } from '@features/workspace/angular/find/workspace-search-adapter';
import { Icon } from '@shared/angular/icons/icon';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { Editors } from '@shared/angular/services/editors/editors';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Search } from '@shared/angular/services/search/search';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { Documents } from '@shared/angular/services/documents/documents';
import { Log } from '@shared/angular/services/log/log';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { ReplaceFailure, ReplaceResponse } from '@shared/api/search-channels';

/**
 * The most result rows rendered at once. Beyond this the list adds nothing to navigate by and every
 * row is DOM cost, so the rest are counted rather than drawn.
 */
const MAX_RENDERED_MATCHES: number = 1000;

/**
 * The most characters of a line shown before its match: enough to read what the match is part of,
 * short enough that the match is on screen in a panel of ordinary width.
 */
const MAX_LEAD: number = 20;

/**
 * Names the panel's two forms, chosen by the strip's toggles.
 */
export type SearchPanelMode = 'find' | 'replace';

/**
 * A results-tree row for a file that has matches: the group its matches sit under.
 */
export interface SearchFileRow {
  /**
   * Gets the discriminant.
   */
  readonly kind: 'file';

  /**
   * Gets the file's path relative to the searched root.
   */
  readonly file: string;

  /**
   * Gets how many matches the file has.
   */
  readonly count: number;
}

/**
 * A results-tree row for one match, beneath its file.
 */
export interface SearchMatchRow {
  /**
   * Gets the discriminant.
   */
  readonly kind: 'match';

  /**
   * Gets the match.
   */
  readonly item: FindResultItem;

  /**
   * Gets the match's index in the adapter's flat match list, which is what selecting it takes.
   */
  readonly index: number;
}

/**
 * A row of the results tree.
 */
export type SearchResultRow = SearchFileRow | SearchMatchRow;

/**
 * The workspace's Find & Replace panel: search across the open folder's files, or replace in them.
 *
 * Its tool strip (#882) holds two toggles — Find in Files and Replace in Files — in the Terminal
 * strip's style; each shows its own form beneath the strip, and the rest of the panel is the results.
 * The two forms share one query and one set of options, so moving from finding to replacing keeps what
 * was found.
 *
 * ⛔ A search runs when asked — the Find button, or Enter in a field — never on each keystroke: a
 * workspace search crawls every file under the root. Changing a match option re-runs the search last
 * asked for, since the option refines it.
 *
 * The replace form previews what it would do, row by row, and writes the files on disk: Replace changes
 * the selected match and moves to the next, Replace All changes every match in the files listed. ⛔ A
 * file open with unsaved edits is never replaced under the user — it is skipped and named, so their
 * edits are neither overwritten nor met with a conflict they did not cause.
 */
@Component({
  selector: 'app-search-panel',
  imports: [Chip, AppIcon, Button, Checkbox, PanelToolbar, TextField, TreeView],
  templateUrl: './search-panel.html',
  styleUrl: './search-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchPanel implements OnDestroy {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the dock panel descriptor this body renders. Set by the dock outlet, which binds it on every
   * projected panel component; unused here because the dock chrome renders the title.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the search client that runs the query in the main process.
   */
  private readonly search: Search = inject(Search);

  /**
   * Holds the file opener used to open a match's file.
   */
  private readonly fileOpener: FileOpener = inject(FileOpener);

  /**
   * Holds the editor registry used to reveal an opened match's line.
   */
  private readonly editors: Editors = inject(Editors);

  /**
   * Holds the active-workspace seam supplying the root to search.
   */
  private readonly activeWorkspace: ActiveWorkspace = inject(ActiveWorkspace);

  /**
   * Holds this view's documents, which say which files are open with unsaved edits.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds the notification centre a replace reports its outcome to.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the structured logger, which records why a replace failed.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the workspace adapter the panel drives, rooted at the active workspace.
   */
  protected readonly adapter: WorkspaceSearchAdapter = new WorkspaceSearchAdapter(
    this.search,
    this.fileOpener,
    this.editors,
    (): string | null => this.activeWorkspace.rootPath(),
  );

  /**
   * Holds which form the strip's toggles have chosen. Find, until the user asks to replace.
   */
  protected readonly mode: WritableSignal<SearchPanelMode> = signal<SearchPanelMode>('find');

  /**
   * Holds the find text in the field, which is not a search until it is asked for.
   */
  protected readonly draft: WritableSignal<string> = signal<string>('');

  /**
   * Holds the replacement text in the replace form's field.
   */
  protected readonly replacement: WritableSignal<string> = signal<string>('');

  /**
   * Holds the text last searched for, or null before any search — what an option change re-runs.
   */
  private readonly searched: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds whether the search is case-sensitive.
   */
  protected readonly caseSensitive: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the search matches whole words only.
   */
  protected readonly wholeWord: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the text is a regular expression.
   */
  protected readonly regexp: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the matches for the last search.
   */
  protected readonly matches: Signal<readonly FindResultItem[]> = this.adapter.matches;

  /**
   * Holds the files whose matches are folded away. Every file starts open: the matches are what was
   * asked for, and a fold is the user's to make.
   */
  private readonly collapsedFiles: WritableSignal<ReadonlySet<string>> = signal<
    ReadonlySet<string>
  >(new Set<string>());

  /**
   * Gets the results as a tree: each file, in the order its first match was found, with its matches
   * beneath it while it is open. Capped at {@link MAX_RENDERED_MATCHES} matches, so a broad search
   * cannot materialise rows past the point of being navigable.
   */
  protected readonly resultRows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] => {
    const shown: readonly FindResultItem[] = this.matches().slice(0, MAX_RENDERED_MATCHES);
    const byFile: Map<string, { readonly item: FindResultItem; readonly index: number }[]> =
      new Map<string, { readonly item: FindResultItem; readonly index: number }[]>();
    shown.forEach((item: FindResultItem, index: number): void => {
      const file: string = item.file ?? '';
      const group: { readonly item: FindResultItem; readonly index: number }[] =
        byFile.get(file) ?? [];
      group.push({ item, index });
      byFile.set(file, group);
    });
    const collapsed: ReadonlySet<string> = this.collapsedFiles();
    const rows: TreeRow[] = [];
    for (const [file, group] of byFile) {
      const open: boolean = !collapsed.has(file);
      const fileRow: SearchFileRow = { kind: 'file', file, count: group.length };
      rows.push({ id: `file:${file}`, depth: 0, expandable: true, expanded: open, data: fileRow });
      if (open) {
        for (const { item, index } of group) {
          const matchRow: SearchMatchRow = { kind: 'match', item, index };
          rows.push({
            id: `match:${index}`,
            depth: 1,
            expandable: false,
            expanded: false,
            data: matchRow,
          });
        }
      }
    }
    return rows;
  });

  /**
   * Gets the id of the selected match's row, or null when no match is selected.
   */
  protected readonly selectedRowId: Signal<string | null> = computed((): string | null =>
    this.adapter.activeIndex() >= 0 ? `match:${this.adapter.activeIndex()}` : null,
  );

  /**
   * Gets how many matches lie beyond the rendered cap.
   */
  protected readonly matchOverflow: Signal<number> = computed((): number =>
    Math.max(0, this.matches().length - MAX_RENDERED_MATCHES),
  );

  /**
   * Gets whether the results preview their replacement: in the replace form, once there is something
   * to replace with.
   */
  protected readonly previewsReplacement: Signal<boolean> = computed(
    (): boolean => this.mode() === 'replace',
  );

  /**
   * Holds whether a replace is writing files, during which neither replace button runs another.
   */
  private readonly replacing: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets whether Replace can run: a match is selected and no replace is under way.
   */
  protected readonly canReplace: Signal<boolean> = computed(
    (): boolean => this.adapter.activeIndex() >= 0 && !this.replacing(),
  );

  /**
   * Gets whether Replace All can run: there are results and no replace is under way.
   */
  protected readonly canReplaceAll: Signal<boolean> = computed(
    (): boolean => this.matches().length > 0 && !this.replacing(),
  );

  /**
   * Gets the summary beside the form's buttons, or empty before anything has been searched for.
   */
  protected readonly summary: Signal<string> = computed((): string => {
    const searched: string | null = this.searched();
    if (searched === null || searched.length === 0) {
      return '';
    }
    const count: number = this.matches().length;
    if (count === 0) {
      return 'No results';
    }
    const files: number = new Set<string | undefined>(
      this.matches().map((item: FindResultItem): string | undefined => item.file),
    ).size;
    return `${count} ${count === 1 ? 'result' : 'results'} in ${files} ${files === 1 ? 'file' : 'files'}`;
  });

  /**
   * Holds the find field's host element, focused when the panel opens or a form is chosen.
   */
  private readonly findField: Signal<ElementRef<HTMLElement> | undefined> =
    viewChild<ElementRef<HTMLElement>>('findField');

  /**
   * Initializes a new instance of the {@link SearchPanel} class, focusing the find field once
   * rendered: the panel is opened to be typed into.
   */
  public constructor() {
    afterNextRender((): void => this.focusFind());
  }

  /**
   * Shows one of the two forms, keeping the query and options the other was using.
   * @param mode The form to show.
   */
  protected show(mode: SearchPanelMode): void {
    this.mode.set(mode);
    queueMicrotask((): void => this.focusFind());
  }

  /**
   * Runs the search for the text in the find field, with the current options.
   */
  protected find(): void {
    this.searched.set(this.draft());
    // A new search starts with every file open: a fold made in the last one says nothing about this.
    this.collapsedFiles.set(new Set<string>());
    this.run();
  }

  /**
   * Re-runs the last search after a match option changed.
   */
  protected optionChanged(): void {
    if (this.searched() !== null) {
      this.run();
    }
  }

  /**
   * Handles a click on a results row: a file folds or unfolds its matches, and a match opens its file
   * at the match.
   * @param treeRow The row clicked.
   */
  protected onRowClick(treeRow: TreeRow): void {
    const row: SearchResultRow = this.rowOf(treeRow);
    if (row.kind === 'match') {
      this.adapter.select(row.index);
      return;
    }
    this.collapsedFiles.update((collapsed: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set<string>(collapsed);
      if (!next.delete(row.file)) {
        next.add(row.file);
      }
      return next;
    });
  }

  /**
   * Gets whether there are results to fold, which is what the strip's Expand and Collapse All act on.
   */
  protected readonly hasResults: Signal<boolean> = computed(
    (): boolean => this.matches().length > 0,
  );

  /**
   * Opens every file in the results, showing all their matches.
   */
  protected expandAll(): void {
    this.collapsedFiles.set(new Set<string>());
  }

  /**
   * Folds every file in the results, leaving one row per file.
   */
  protected collapseAll(): void {
    this.collapsedFiles.set(
      new Set<string>(this.matches().map((item: FindResultItem): string => item.file ?? '')),
    );
  }

  /**
   * Unwraps a results row's payload.
   * @param treeRow The tree row.
   * @returns Returns the results row.
   */
  protected rowOf(treeRow: TreeRow): SearchResultRow {
    return treeRow.data as SearchResultRow;
  }

  /**
   * Shortens the text before a match to its last {@link MAX_LEAD} characters, so the match itself
   * stays in view: a row is one line, and a long lead-in pushed the match past the panel's edge, where
   * the ellipsis swallowed exactly the part that was searched for.
   * @param before The line text before the match.
   * @returns Returns the lead-in, with a leading ellipsis when it was shortened.
   */
  protected lead(before: string): string {
    const trimmed: string = before.trimStart();
    return trimmed.length <= MAX_LEAD ? trimmed : `…${trimmed.slice(-MAX_LEAD)}`;
  }

  /**
   * Gets the icon a result file is drawn with, the same as in the File Explorer.
   * @param file The file's relative path.
   * @returns Returns the icon.
   */
  protected fileIcon(file: string): Icon {
    return fileIconFor(file);
  }

  /**
   * Replaces the selected match and moves to the next — unless its file has unsaved edits.
   */
  protected async replaceSelected(): Promise<void> {
    const path: string | null = this.adapter.activePath();
    if (path === null || !this.canReplace()) {
      return;
    }
    if (this.unsavedPaths().has(path)) {
      this.notifications.notify({
        severity: 'warning',
        title: `Save “${baseName(path)}” first`,
        detail: 'It has unsaved edits, so the match was not replaced.',
      });
      return;
    }
    await this.replaceWith(
      (): Promise<ReplaceResponse | null> => this.adapter.replaceMatch(this.replacement()),
      [],
    );
  }

  /**
   * Replaces every match in the files listed, but for those with unsaved edits.
   */
  protected async replaceEvery(): Promise<void> {
    if (!this.canReplaceAll()) {
      return;
    }
    const unsaved: ReadonlySet<string> = this.unsavedPaths();
    const skipped: readonly string[] = this.adapter
      .paths()
      .filter((path: string): boolean => unsaved.has(path));
    await this.replaceWith(
      (): Promise<ReplaceResponse | null> =>
        this.adapter.replaceFiles(this.replacement(), new Set<string>(skipped)),
      skipped,
    );
  }

  /**
   * Clears the results when the panel goes, so nothing stays highlighted behind it.
   */
  public ngOnDestroy(): void {
    this.adapter.clear();
  }

  /**
   * Hands the last searched-for text and the current options to the adapter.
   */
  private run(): void {
    const query: FindQuery = {
      text: this.searched() ?? '',
      caseSensitive: this.caseSensitive(),
      wholeWord: this.wholeWord(),
      regexp: this.regexp(),
    };
    this.adapter.setQuery(query);
  }

  /**
   * Runs a replace, holding the buttons off while it writes, and reports what it did.
   * @param replace Runs the replace.
   * @param skipped The files left alone for their unsaved edits.
   */
  private async replaceWith(
    replace: () => Promise<ReplaceResponse | null>,
    skipped: readonly string[],
  ): Promise<void> {
    this.replacing.set(true);
    try {
      const response: ReplaceResponse | null = await replace();
      this.report(response ?? { replaced: 0, files: 0, failed: [] }, skipped);
    } catch (error: unknown) {
      this.log.error('SearchPanel', 'Replace failed', error);
      this.notifications.notify({
        severity: 'error',
        title: 'Could not replace',
        detail: 'The files could not be reached.',
      });
    } finally {
      this.replacing.set(false);
    }
  }

  /**
   * Reports a replace's outcome: what changed, and every file that was left alone and why.
   * @param response What the replace did.
   * @param skipped The files left alone for their unsaved edits.
   */
  private report(response: ReplaceResponse, skipped: readonly string[]): void {
    const notes: string[] = [
      ...skipped.map((path: string): string => `${baseName(path)} has unsaved edits.`),
      ...response.failed.map(
        (failure: ReplaceFailure): string => `${baseName(failure.path)}: ${failure.reason}`,
      ),
    ];
    const replaced: number = response.replaced;
    const title: string =
      replaced === 0
        ? 'Nothing was replaced'
        : `Replaced ${replaced} ${replaced === 1 ? 'match' : 'matches'} in ${response.files} ${response.files === 1 ? 'file' : 'files'}`;
    this.notifications.notify({
      severity: notes.length > 0 ? 'warning' : 'success',
      title,
      ...(notes.length > 0 ? { detail: notes.join(' ') } : {}),
    });
  }

  /**
   * Gets the paths of this view's files that are open with unsaved edits.
   * @returns Returns the absolute paths.
   */
  private unsavedPaths(): ReadonlySet<string> {
    const paths: Set<string> = new Set<string>();
    for (const document of this.documents.list()) {
      const path: string | null = document.filePath();
      if (path !== null && document.dirty()) {
        paths.add(path);
      }
    }
    return paths;
  }

  /**
   * Puts the cursor in the find field.
   */
  private focusFind(): void {
    this.findField()?.nativeElement.querySelector('input')?.focus();
  }
}

/**
 * Gets the last segment of a path, its file name.
 * @param path The path.
 * @returns Returns the file name.
 */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
