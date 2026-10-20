import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  InputSignal,
  linkedSignal,
  output,
  OutputEmitterRef,
  Signal,
  untracked,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { FindResultItem } from '@shared/angular/components/find-panel/find-adapter';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { SearchResultsTree } from '@shared/angular/components/search-view/search-results-tree';
import { Icon } from '@shared/angular/icons/icon';
import type {
  ReferenceItem,
  ReferenceList,
} from '@shared/angular/services/references/reference-list';

/**
 * The parts of a list's heading: the words before the symbol, the symbol, and the words after it — so
 * the symbol can be set as code between them.
 */
export interface ReferencesHeading {
  /**
   * Gets the words before the symbol.
   */
  readonly lead: string;

  /**
   * Gets the symbol, or an empty string when the heading names none.
   */
  readonly symbol: string;

  /**
   * Gets the words after the symbol.
   */
  readonly tail: string;
}

/**
 * Studio's references list, as one view wherever it is shown (#1014): the workspace's References panel
 * at the bottom beside the Error List, and a standalone code tab's own References panel. It shows one
 * {@link ReferenceList} — every reference to a symbol, or the several places it is defined — grouped by
 * file in the shared search results tree, each row its line with the reference set off.
 *
 * Its strip heads the list with what was searched for ("12 references to `Foo` in 4 files") and folds
 * the tree; choosing a row reports the place through {@link chosen}, for the host to go to. A new list
 * replaces the last, with every file open and nothing chosen.
 */
@Component({
  selector: 'app-references-view',
  imports: [Button, PanelToolbar, SearchResultsTree],
  templateUrl: './references-view.html',
  styleUrl: './references-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReferencesView {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the list to show, or null before the first search.
   */
  public readonly list: InputSignal<ReferenceList | null> = input<ReferenceList | null>(null);

  /**
   * Gets the folder a file is named relative to — the workspace's root — or null to name each file by
   * its full path.
   */
  public readonly relativeTo: InputSignal<string | null> = input<string | null>(null);

  /**
   * Emits the place the user chose, for the host to go to.
   */
  public readonly chosen: OutputEmitterRef<ReferenceItem> = output<ReferenceItem>();

  /**
   * Holds the results tree, which the strip's Expand and Collapse All fold.
   */
  private readonly tree: Signal<SearchResultsTree | undefined> =
    viewChild<SearchResultsTree>(SearchResultsTree);

  /**
   * Holds the index of the chosen row in the list, reset to none by each new list.
   */
  protected readonly activeIndex: WritableSignal<number> = linkedSignal<
    ReferenceList | null,
    number
  >({
    source: this.list,
    computation: (): number => -1,
  });

  /**
   * Gets the places listed, as the results tree lists matches: each in its file, its line split
   * around the span so the span can be set off.
   */
  protected readonly items: Signal<readonly FindResultItem[]> = computed(
    (): readonly FindResultItem[] => {
      const root: string | null = this.relativeTo();
      return (this.list()?.items ?? []).map((item: ReferenceItem): FindResultItem =>
        toResult(item, root),
      );
    },
  );

  /**
   * Gets whether the list has places to fold, which is what the strip's Expand and Collapse All act
   * on.
   */
  protected readonly hasItems: Signal<boolean> = computed((): boolean => this.items().length > 0);

  /**
   * Gets the heading over the list: what was searched for and, once answered, how much was found.
   */
  protected readonly heading: Signal<ReferencesHeading> = computed((): ReferencesHeading =>
    headingFor(this.list()),
  );

  /**
   * Gets the plain words shown where there is nothing to list, or null while there are places.
   */
  protected readonly emptyMessage: Signal<string | null> = computed((): string | null => {
    const list: ReferenceList | null = this.list();
    if (list === null) {
      return 'Find All References on a symbol — in its right-click menu — lists every place it is used.';
    }
    if (list.status === 'searching') {
      return null;
    }
    if (list.status === 'unavailable') {
      return 'Nothing can find references in this file. A language server for its language would.';
    }
    return list.items.length === 0 ? 'No references were found.' : null;
  });

  /**
   * Initializes a new instance of the {@link ReferencesView} class, opening every file again for each
   * new list: a fold made in the last one says nothing about this.
   */
  public constructor() {
    effect((): void => {
      this.list();
      untracked((): void => this.tree()?.expandAll());
    });
  }

  /**
   * Opens every file in the list.
   */
  protected expandAll(): void {
    this.tree()?.expandAll();
  }

  /**
   * Folds every file in the list, leaving one row per file.
   */
  protected collapseAll(): void {
    this.tree()?.collapseAll();
  }

  /**
   * Handles a chosen row: marks it, and reports its place.
   * @param index The row's index in the list.
   */
  protected choose(index: number): void {
    const item: ReferenceItem | undefined = this.list()?.items[index];
    if (item === undefined) {
      return;
    }
    this.activeIndex.set(index);
    this.chosen.emit(item);
  }
}

/**
 * Builds the heading for a list.
 * @param list The list, or null before the first search.
 * @returns Returns the heading.
 */
export function headingFor(list: ReferenceList | null): ReferencesHeading {
  if (list === null) {
    return { lead: 'References', symbol: '', tail: '' };
  }
  const references: boolean = list.kind === 'references';
  if (list.status === 'searching') {
    return list.symbol.length === 0
      ? { lead: 'Finding references…', symbol: '', tail: '' }
      : { lead: 'Finding references to ', symbol: list.symbol, tail: '…' };
  }
  const count: number = list.items.length;
  const files: number = new Set<string>(list.items.map((item: ReferenceItem): string => item.path))
    .size;
  const noun: string = references
    ? count === 1
      ? 'reference'
      : 'references'
    : count === 1
      ? 'definition'
      : 'definitions';
  const tail: string = count === 0 ? '' : ` in ${files} ${files === 1 ? 'file' : 'files'}`;
  if (list.symbol.length === 0) {
    return { lead: `${count} ${noun}${tail}`, symbol: '', tail: '' };
  }
  return { lead: `${count} ${noun} ${references ? 'to' : 'of'} `, symbol: list.symbol, tail };
}

/**
 * Converts a listed place to the results tree's match: its file named relative to the root where it
 * lies beneath it, and its line split around the span — the span cut to its first line.
 * @param item The place.
 * @param root The folder files are named relative to, or null for full paths.
 * @returns Returns the match.
 */
function toResult(item: ReferenceItem, root: string | null): FindResultItem {
  const { range, preview } = item;
  const start: number = Math.max(0, range.startColumn - 1);
  const end: number =
    range.endLineNumber === range.startLineNumber
      ? Math.max(start, range.endColumn - 1)
      : preview.length;
  return {
    line: range.startLineNumber,
    column: range.startColumn,
    before: preview.slice(0, start),
    text: preview.slice(start, end),
    after: preview.slice(end),
    file: displayPath(item.path, root),
  };
}

/**
 * Names a file as the list shows it: relative to the root when it lies beneath it, else in full.
 * @param path The file's absolute path, or a model URI.
 * @param root The root, or null.
 * @returns Returns the name.
 */
function displayPath(path: string, root: string | null): string {
  if (root === null || root.length === 0) {
    return path;
  }
  const prefix: string = /[\\/]$/.test(root) ? root : `${root}/`;
  const normalised: string = path.replace(/\\/g, '/');
  const base: string = prefix.replace(/\\/g, '/');
  return normalised.startsWith(base) ? normalised.slice(base.length) : path;
}
