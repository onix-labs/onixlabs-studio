import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { Log } from '@shared/angular/services/log/log';
import { GitFileChange } from '@shared/angular/services/repository/repository-data';

/**
 * An open diff's editor, as a panel hosting one registers it (#1007): what the Search panel searches
 * — read-only — on the diff's changed side.
 */
export interface OpenDiffEditor {
  /**
   * Gets the dock panel id of the diff.
   */
  readonly id: string;

  /**
   * Resolves the absolute path of the compared file, or null when there is none.
   */
  readonly path: () => string | null;

  /**
   * Resolves the editor showing the diff's changed side, or null before it exists.
   */
  readonly modifiedEditor: () => MonacoApi.editor.ICodeEditor | null;
}

/**
 * Holds the diffs currently open in the source-control document well, keyed by their dock panel id,
 * together with the shared side-by-side/inline rendering preference. This is the diff counterpart of
 * the workspace's {@link import('../documents/documents').Documents} store: the document panels keep
 * only an id, and resolve their {@link GitFileChange} from here.
 */
@Service()
export class Diffs {
  /**
   * Holds the open diffs, keyed by dock panel id.
   */
  private readonly entries: WritableSignal<ReadonlyMap<string, GitFileChange>> = signal<
    ReadonlyMap<string, GitFileChange>
  >(new Map<string, GitFileChange>());

  /**
   * Holds whether diffs render inline (unified) rather than side by side. Shared across every open
   * diff so the ribbon's toggle flips them together.
   */
  private readonly inline: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the editors of the diffs open now, by dock panel id.
   */
  private readonly editors: Map<string, OpenDiffEditor> = new Map<string, OpenDiffEditor>();

  /**
   * Gets whether diffs render inline rather than side by side.
   */
  public readonly inlineDiff: Signal<boolean> = this.inline.asReadonly();

  /**
   * Builds the stable dock panel id for a file's diff, so reopening the same file reuses its tab.
   * @param path The file path.
   * @returns Returns the diff panel id.
   */
  public idForPath(path: string): string {
    return `diff:${path}`;
  }

  /**
   * Records (or replaces) the diff shown by a panel id.
   * @param id The dock panel id.
   * @param file The file change to compare.
   */
  public put(id: string, file: GitFileChange): void {
    this.entries.update(
      (current: ReadonlyMap<string, GitFileChange>): ReadonlyMap<string, GitFileChange> =>
        new Map<string, GitFileChange>(current).set(id, file),
    );
  }

  /**
   * Gets the diff shown by a panel id, or null when none is open for it.
   * @param id The dock panel id.
   * @returns Returns the file change, or null.
   */
  public get(id: string): GitFileChange | null {
    return this.entries().get(id) ?? null;
  }

  /**
   * Determines whether a diff is open for the given panel id.
   * @param id The dock panel id.
   * @returns Returns true when a diff is recorded for the id.
   */
  public has(id: string): boolean {
    return this.entries().has(id);
  }

  /**
   * Lists the panel ids of the diffs open now.
   * @returns Returns the ids, in the order they were opened.
   */
  public ids(): readonly string[] {
    return [...this.entries().keys()];
  }

  /**
   * Toggles inline versus side-by-side rendering for every open diff.
   */
  public toggleInline(): void {
    this.setInline(!this.inline());
  }

  /**
   * Sets inline versus side-by-side rendering for every open diff.
   *
   * Separate from {@link toggleInline} because a control that shows both choices asks for the one it
   * wants rather than for the other one: picking "Inline" from a list twice must leave it inline.
   *
   * @param inline Whether diffs render inline (unified) rather than side by side.
   */
  public setInline(inline: boolean): void {
    if (this.inline() === inline) {
      return;
    }
    this.inline.set(inline);
    this.log.debug('Diffs', `Diff layout set to ${inline ? 'inline' : 'side-by-side'}`);
  }

  /**
   * Drops the records for diff panels no longer present in the layout, so closed diffs are not
   * retained. Diff ids are namespaced (`diff:`), so non-diff panel ids are ignored.
   * @param present The set of panel ids still present in the dock layout.
   */
  public removeMissing(present: ReadonlySet<string>): void {
    const current: ReadonlyMap<string, GitFileChange> = this.entries();
    let changed: boolean = false;
    const next: Map<string, GitFileChange> = new Map<string, GitFileChange>(current);
    for (const id of current.keys()) {
      if (!present.has(id)) {
        next.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.entries.set(next);
    }
  }

  /**
   * Registers (or replaces) an open diff's editor, so the Search panel can search its changed side.
   * @param editor The diff's editor.
   */
  public registerEditor(editor: OpenDiffEditor): void {
    this.editors.set(editor.id, editor);
  }

  /**
   * Unregisters a diff's editor, if it is the one registered for its id.
   * @param editor The diff's editor.
   */
  public unregisterEditor(editor: OpenDiffEditor): void {
    if (this.editors.get(editor.id) === editor) {
      this.editors.delete(editor.id);
    }
  }

  /**
   * Lists the editors of the diffs open now.
   * @returns Returns the editors, in the order they were opened.
   */
  public openEditors(): readonly OpenDiffEditor[] {
    return [...this.editors.values()];
  }
}
