import { computed, signal, Signal, WritableSignal } from '@angular/core';
import { FindQuery, FindResultItem } from '@shared/angular/components/find-panel/find-adapter';
import { FindScope } from '@shared/angular/components/find-panel/find-request';
import { Editors } from '@shared/angular/services/editors/editors';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { Search } from '@shared/angular/services/search/search';
import { ReplaceResponse } from '@shared/api/search-channels';
import { SearchAdapter } from '@shared/angular/components/search-view/search-adapter';
import {
  EditorSearchTarget,
  OpenEditorsFindAdapter,
} from '@shared/angular/components/search-view/open-editors-find-adapter';
import { WorkspaceSearchAdapter } from '@features/workspace/angular/find/workspace-search-adapter';

/**
 * What a {@link ScopedSearchAdapter} reaches into to search each scope.
 */
export interface ScopedSearchSources {
  /**
   * Gets the search client that runs a disk search in the main process.
   */
  readonly search: Search;

  /**
   * Gets the file opener a disk match's file is opened with.
   */
  readonly fileOpener: FileOpener;

  /**
   * Gets the editor registry a disk match is revealed through.
   */
  readonly editors: Editors;

  /**
   * Resolves the active workspace root, or null when no folder is open.
   */
  readonly rootOf: () => string | null;

  /**
   * Resolves the absolute path of the active file's project folder, or null when it has none.
   */
  readonly projectDirectoryOf: () => string | null;

  /**
   * Resolves the open editors an in-memory scope searches.
   * @param scope The scope: Open Files, Current File or Current Selection.
   */
  readonly editorTargetsOf: (scope: FindScope) => readonly EditorSearchTarget[];
}

/**
 * Gets whether a scope searches the files on disk (with ripgrep) rather than the open editors.
 * @param scope The scope.
 * @returns Returns true for Whole Workspace and Current Project.
 */
export function searchesDisk(scope: FindScope): boolean {
  return scope === 'workspace' || scope === 'project';
}

/**
 * Drives the Search panel's find over whichever scope is chosen (#1007), behind the one
 * {@link SearchAdapter} the shared search view drives.
 *
 * Whole Workspace and Current Project search the files on disk through the workspace adapter — the
 * project's folder handed to ripgrep as the one path to search — and replace them on disk. Open Files,
 * Current File and Current Selection search the open editors' models through the open-editors adapter,
 * unsaved edits included, and replace by editor edit. Only the chosen backend holds results: changing
 * scope clears the other, so no highlight or result outlives the scope it came from.
 */
export class ScopedSearchAdapter implements SearchAdapter {
  /**
   * Holds the chosen scope.
   */
  private readonly scopeState: WritableSignal<FindScope> = signal<FindScope>('workspace');

  /**
   * Holds the disk backend, for Whole Workspace and Current Project.
   */
  private readonly disk: WorkspaceSearchAdapter;

  /**
   * Holds the in-memory backend, for Open Files, Current File and Current Selection.
   */
  private readonly memory: OpenEditorsFindAdapter;

  /**
   * Gets the chosen scope.
   */
  public readonly scope: Signal<FindScope> = this.scopeState.asReadonly();

  /**
   * Gets whether the chosen scope searches the files on disk.
   */
  public readonly onDisk: Signal<boolean> = computed((): boolean =>
    searchesDisk(this.scopeState()),
  );

  /**
   * Gets the chosen backend's matches.
   */
  public readonly matches: Signal<readonly FindResultItem[]> = computed(
    (): readonly FindResultItem[] => this.backend().matches(),
  );

  /**
   * Gets the chosen backend's active match index.
   */
  public readonly activeIndex: Signal<number> = computed((): number =>
    this.backend().activeIndex(),
  );

  /**
   * Gets a value indicating that every scope supports replace.
   */
  public readonly supportsReplace: boolean = true;

  /**
   * Gets whether the chosen backend's last replace can be undone (only an editor edit can be).
   */
  public readonly canUndo: Signal<boolean> = computed((): boolean => this.backend().canUndo());

  /**
   * Initializes a new instance of the {@link ScopedSearchAdapter} class.
   * @param sources What each scope reaches into.
   */
  public constructor(sources: ScopedSearchSources) {
    this.disk = new WorkspaceSearchAdapter(
      sources.search,
      sources.fileOpener,
      sources.editors,
      sources.rootOf,
      (): readonly string[] | undefined => {
        if (this.scopeState() !== 'project') {
          return undefined;
        }
        const directory: string | null = sources.projectDirectoryOf();
        return directory === null ? undefined : [directory];
      },
    );
    this.memory = new OpenEditorsFindAdapter(
      (scope: FindScope): readonly EditorSearchTarget[] => sources.editorTargetsOf(scope),
      'open-files',
    );
  }

  /**
   * Chooses the scope, clearing what the last one found. The caller searches again.
   * @param scope The scope.
   */
  public setScope(scope: FindScope): void {
    if (scope === this.scopeState()) {
      return;
    }
    this.backend().clear();
    this.scopeState.set(scope);
    if (!searchesDisk(scope)) {
      this.memory.setScope(scope);
    }
  }

  /**
   * Applies a query in the chosen scope.
   * @param query The query to search for.
   */
  public setQuery(query: FindQuery): void {
    this.backend().setQuery(query);
  }

  /**
   * Selects and reveals the match at the given index.
   * @param index The zero-based index of the match.
   */
  public select(index: number): void {
    this.backend().select(index);
  }

  /**
   * Selects and reveals the next match.
   */
  public next(): void {
    this.backend().next();
  }

  /**
   * Selects and reveals the previous match.
   */
  public previous(): void {
    this.backend().previous();
  }

  /**
   * Replaces the active match.
   * @param replacement The text to replace it with.
   */
  public replace(replacement: string): void {
    void this.replaceMatch(replacement);
  }

  /**
   * Replaces every match.
   * @param replacement The text to replace each match with.
   */
  public replaceAll(replacement: string): void {
    void this.replaceFiles(replacement, new Set<string>());
  }

  /**
   * Undoes the last editor-edit replace; a disk replace has nothing to undo.
   */
  public undo(): void {
    this.backend().undo();
  }

  /**
   * Clears both backends' results and highlights.
   */
  public clear(): void {
    this.disk.clear();
    this.memory.clear();
  }

  /**
   * Gets the absolute path of the active match's file, or null when no match is active.
   * @returns Returns the path, or null.
   */
  public activePath(): string | null {
    return this.onDisk() ? this.disk.activePath() : this.memory.activePath();
  }

  /**
   * Gets the absolute paths of the files with matches, in the order they were found.
   * @returns Returns the paths.
   */
  public paths(): readonly string[] {
    return this.onDisk() ? this.disk.paths() : this.memory.paths();
  }

  /**
   * Gets whether the active match can be replaced — any but a diff's.
   * @returns Returns true when Replace can change it.
   */
  public activeReplaceable(): boolean {
    return this.onDisk() || this.memory.activeReplaceable();
  }

  /**
   * Gets whether Replace All has anything to change — any match but a diff's.
   * @returns Returns true when there is a replaceable match.
   */
  public hasReplaceable(): boolean {
    return this.onDisk() ? this.disk.matches().length > 0 : this.memory.hasReplaceable();
  }

  /**
   * Replaces the active match — on disk, or as an editor edit — and moves to the next.
   * @param replacement The text to replace it with.
   * @returns Returns what was replaced, or null when there was no active match.
   */
  public async replaceMatch(replacement: string): Promise<ReplaceResponse | null> {
    return this.onDisk()
      ? this.disk.replaceMatch(replacement)
      : this.memory.replaceMatch(replacement);
  }

  /**
   * Replaces every match — in the files on disk but for those skipped, or as editor edits.
   * @param replacement The text to replace each match with.
   * @param skip The absolute paths of files to leave alone on disk; the editors need no skipping, as
   * an editor edit is what their unsaved edits already are.
   * @returns Returns what was replaced, or null when there was nothing to replace.
   */
  public async replaceFiles(
    replacement: string,
    skip: ReadonlySet<string>,
  ): Promise<ReplaceResponse | null> {
    return this.onDisk()
      ? this.disk.replaceFiles(replacement, skip)
      : this.memory.replaceEvery(replacement);
  }

  /**
   * Gets the backend the chosen scope searches with.
   * @returns Returns the backend.
   */
  private backend(): WorkspaceSearchAdapter | OpenEditorsFindAdapter {
    return this.onDisk() ? this.disk : this.memory;
  }
}
