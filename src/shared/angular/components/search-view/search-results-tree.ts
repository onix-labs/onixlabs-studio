import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Chip } from '@shared/angular/components/chip/chip';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { TreeRow, TreeView } from '@shared/angular/components/tree-view/tree-view';
import { FindResultItem } from '@shared/angular/components/find-panel/find-adapter';
import { fileIconFor } from '@shared/angular/icons/file-icon';
import { Icon } from '@shared/angular/icons/icon';

/**
 * The most result rows rendered at once. Beyond this the list adds nothing to navigate by and every
 * row is DOM cost, so the rest are counted rather than drawn.
 */
const MAX_RENDERED_MATCHES: number = 1000;

/**
 * A results-tree row for a file that has matches: the group its matches sit under.
 */
export interface SearchFileRow {
  /**
   * Gets the discriminant.
   */
  readonly kind: 'file';

  /**
   * Gets the file's path as the results name it — relative to the searched root, where there is one.
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
   * Gets the match's index in the flat list the tree was given, which is what choosing it reports.
   */
  readonly index: number;
}

/**
 * A row of the results tree.
 */
export type SearchResultRow = SearchFileRow | SearchMatchRow;

/**
 * The read-only results tree Studio's searches share: matches grouped beneath their files, each row a
 * line number and the line, the matched span set off as a chip so it stays in view. The Find & Replace
 * view draws its results with it (#1007), and so does Find All References (#1014) — one list, wherever
 * a search lists places in files.
 *
 * Every file starts open; clicking one folds or unfolds it, and clicking a match reports its index in
 * the flat list through {@link chosen}. The host keeps which match is active and, in a replace form,
 * the replacement each match previews.
 */
@Component({
  selector: 'app-search-results-tree',
  imports: [Chip, AppIcon, TreeView],
  templateUrl: './search-results-tree.html',
  styleUrl: './search-results-tree.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchResultsTree {
  /**
   * Gets the matches to list, in the order they were found; each file is grouped where its first
   * match falls.
   */
  public readonly items: InputSignal<readonly FindResultItem[]> =
    input.required<readonly FindResultItem[]>();

  /**
   * Gets the index of the active match in {@link items}, or -1 when none is.
   */
  public readonly activeIndex: InputSignal<number> = input<number>(-1);

  /**
   * Gets the text each match would be replaced with, previewed beside it, or null to show the
   * matches as they are.
   */
  public readonly replacement: InputSignal<string | null> = input<string | null>(null);

  /**
   * Emits the index in {@link items} of the match the user clicked.
   */
  public readonly chosen: OutputEmitterRef<number> = output<number>();

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
  protected readonly rows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] => {
    const shown: readonly FindResultItem[] = this.items().slice(0, MAX_RENDERED_MATCHES);
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
   * Gets the id of the active match's row, or null when no match is active.
   */
  protected readonly selectedRowId: Signal<string | null> = computed((): string | null =>
    this.activeIndex() >= 0 ? `match:${this.activeIndex()}` : null,
  );

  /**
   * Gets how many matches lie beyond the rendered cap.
   */
  protected readonly overflow: Signal<number> = computed((): number =>
    Math.max(0, this.items().length - MAX_RENDERED_MATCHES),
  );

  /**
   * Opens every file in the results, showing all their matches.
   */
  public expandAll(): void {
    this.collapsedFiles.set(new Set<string>());
  }

  /**
   * Folds every file in the results, leaving one row per file.
   */
  public collapseAll(): void {
    this.collapsedFiles.set(
      new Set<string>(this.items().map((item: FindResultItem): string => item.file ?? '')),
    );
  }

  /**
   * Handles a click on a row: a file folds or unfolds its matches, and a match is reported as chosen.
   * @param treeRow The row clicked.
   */
  protected onRowClick(treeRow: TreeRow): void {
    const row: SearchResultRow = this.rowOf(treeRow);
    if (row.kind === 'match') {
      this.chosen.emit(row.index);
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
   * Unwraps a row's payload.
   * @param treeRow The tree row.
   * @returns Returns the results row.
   */
  protected rowOf(treeRow: TreeRow): SearchResultRow {
    return treeRow.data as SearchResultRow;
  }

  /**
   * Readies the text before a match for its row: without the line's indentation, which says nothing
   * about the match. Its length is the row's to decide — the lead-in fills whatever room the panel
   * has, and gives way from its START (see the stylesheet), so the words beside the match are the
   * last to go.
   * @param before The line text before the match.
   * @returns Returns the lead-in.
   */
  protected lead(before: string): string {
    return before.trimStart();
  }

  /**
   * Gets the icon a result file is drawn with, the same as in the File Explorer.
   * @param file The file's path.
   * @returns Returns the icon.
   */
  protected fileIcon(file: string): Icon {
    return fileIconFor(file);
  }
}
