import { computed, signal, Signal, WritableSignal } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { FindQuery, FindResultItem } from '@shared/angular/components/find-panel/find-adapter';
import { FindRange, FindScope } from '@shared/angular/components/find-panel/find-request';
import { ReplaceFailure, ReplaceResponse } from '@shared/api/search-channels';
import { SearchAdapter } from './search-adapter';

/**
 * Word-boundary separators passed to Monaco when a whole-word search is requested, as the code editor's
 * own find uses; a null separator set disables the whole-word constraint.
 */
const WORD_SEPARATORS: string = '`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/? \t\n';

/**
 * Caps the length of each side of a match's line preview, so a long line does not bloat a row.
 */
const PREVIEW_SIDE: number = 240;

/**
 * Caps how many matches one search collects across every editor, as the disk search caps its own, so
 * a broad query over a large open file cannot flood the panel.
 */
const MAX_TOTAL_MATCHES: number = 5000;

/**
 * Monaco's `TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges`, spelt out because only Monaco's types
 * are imported here: a pinned selection keeps to the text it covered, not text typed beside it.
 */
const NEVER_GROWS: MonacoApi.editor.TrackedRangeStickiness = 1;

/**
 * One open editor to search (#1007): a Monaco model — unsaved edits and all — with the editor showing
 * it, where it lives, and how much of it to search.
 */
export interface EditorSearchTarget {
  /**
   * Gets the model to search.
   */
  readonly model: MonacoApi.editor.ITextModel;

  /**
   * Resolves the editor showing the model, or null when none does — what a chosen match is selected
   * and revealed in.
   */
  readonly editor: () => MonacoApi.editor.ICodeEditor | null;

  /**
   * Gets the absolute path of the file the model holds.
   */
  readonly path: string;

  /**
   * Gets the file's label in the results, relative to the workspace root.
   */
  readonly label: string;

  /**
   * Gets the part of the model to search — the selection when the find was asked for — or null for
   * all of it.
   */
  readonly range?: FindRange | null;

  /**
   * Gets whether the model may not be changed: the changed side of a diff, which shows the file as it
   * was when the diff opened, not the file being edited.
   */
  readonly readOnly?: boolean;

  /**
   * Brings the editor's tab to the front, so a chosen match is seen. Optional: a model with no tab of
   * its own is only selected in.
   */
  readonly activate?: () => Promise<unknown> | void;
}

/**
 * A match found in one of the targets, with what replacing it needs.
 */
interface FlatMatch {
  /**
   * Gets the target the match is in.
   */
  readonly target: EditorSearchTarget;

  /**
   * Gets the match's range in the model.
   */
  readonly range: MonacoApi.IRange;

  /**
   * Gets the pattern's captures for the match — the match, then each group — or null for a literal
   * query.
   */
  readonly captures: readonly string[] | null;

  /**
   * Gets the model's version when the match was found: a replace refuses a match whose model has moved
   * on since, because its range may no longer be what was found.
   */
  readonly version: number;

  /**
   * Gets the match as the results list shows it.
   */
  readonly item: FindResultItem;
}

/**
 * Drives the in-memory scopes of the shared search view (#1007) — Open Files, Current File and Current
 * Selection — over open editors' Monaco models rather than the files on disk, so unsaved edits are
 * searched as they stand. The workspace's Search panel uses it for its open editors, and a tab outside
 * a workspace (a code tab, a binary tab's disassembly, an API Explorer request) for the one editor its
 * find came from. Every match is highlighted in its model; a chosen match is selected, centred and
 * focused in its editor; and a replace is an editor edit, on the model's own undo stack — ⌘Z in the
 * editor takes it back, and nothing is written to disk until the user saves.
 *
 * A Current Selection target's range is pinned to the text with a tracking decoration, so it keeps
 * covering the same text as edits above or inside it move it. The changed side of a diff is searched
 * read-only: its matches are listed but never replaced.
 */
export class OpenEditorsFindAdapter implements SearchAdapter {
  /**
   * Holds the chosen scope, which the targets are resolved for.
   */
  private readonly scopeState: WritableSignal<FindScope>;

  /**
   * Holds the match list shown by the panel.
   */
  private readonly matchesState: WritableSignal<readonly FindResultItem[]> = signal<
    readonly FindResultItem[]
  >([]);

  /**
   * Holds the zero-based index of the active match, or -1 when none.
   */
  private readonly activeIndexState: WritableSignal<number> = signal<number>(-1);

  /**
   * Holds the replaces that can be undone, newest last: the models each one changed.
   */
  private readonly undoStack: WritableSignal<readonly (readonly MonacoApi.editor.ITextModel[])[]> =
    signal<readonly (readonly MonacoApi.editor.ITextModel[])[]>([]);

  /**
   * Holds the matches, parallel to the match list.
   */
  private flat: readonly FlatMatch[] = [];

  /**
   * Holds the editors being searched, fixed when the query is set.
   */
  private targets: readonly EditorSearchTarget[] = [];

  /**
   * Holds the query last set, or null before any.
   */
  private lastQuery: FindQuery | null = null;

  /**
   * Holds each model's match highlights, by model.
   */
  private readonly highlights: Map<MonacoApi.editor.ITextModel, string[]> = new Map<
    MonacoApi.editor.ITextModel,
    string[]
  >();

  /**
   * Holds the decorations pinning each limited target's range to its text, by target.
   */
  private readonly trackers: Map<EditorSearchTarget, string> = new Map<
    EditorSearchTarget,
    string
  >();

  /**
   * Gets the chosen scope.
   */
  public readonly scope: Signal<FindScope>;

  /**
   * Gets a value indicating that the open editors are searched, never the files on disk.
   */
  public readonly onDisk: Signal<boolean> = signal<boolean>(false).asReadonly();

  /**
   * Gets the match list.
   */
  public readonly matches: Signal<readonly FindResultItem[]> = this.matchesState.asReadonly();

  /**
   * Gets the zero-based index of the active match, or -1 when there is none.
   */
  public readonly activeIndex: Signal<number> = this.activeIndexState.asReadonly();

  /**
   * Gets a value indicating that the open editors support replace (but for a diff's matches).
   */
  public readonly supportsReplace: boolean = true;

  /**
   * Gets whether the last replace can be undone.
   */
  public readonly canUndo: Signal<boolean> = computed((): boolean => this.undoStack().length > 0);

  /**
   * Initializes a new instance of the {@link OpenEditorsFindAdapter} class.
   * @param targetsOf Resolves the editors a scope searches, asked each time a query is set.
   * @param initialScope The scope chosen until another is.
   */
  public constructor(
    private readonly targetsOf: (scope: FindScope) => readonly EditorSearchTarget[],
    initialScope: FindScope = 'file',
  ) {
    this.scopeState = signal<FindScope>(initialScope);
    this.scope = this.scopeState.asReadonly();
  }

  /**
   * Chooses the scope, clearing what the last one found. The caller searches again.
   * @param scope The scope.
   */
  public setScope(scope: FindScope): void {
    if (scope === this.scopeState()) {
      return;
    }
    this.clear();
    this.scopeState.set(scope);
  }

  /**
   * Applies a query over the editors in scope now, rebuilding the matches and their highlights. An
   * empty query clears them.
   * @param query The query to search for.
   */
  public setQuery(query: FindQuery): void {
    this.untrack();
    this.lastQuery = query;
    this.undoStack.set([]);
    this.targets = query.text.length === 0 ? [] : this.targetsOf(this.scopeState());
    for (const target of this.targets) {
      if (target.range !== null && target.range !== undefined && !target.model.isDisposed()) {
        const [id] = target.model.deltaDecorations(
          [],
          [{ range: target.range, options: { stickiness: NEVER_GROWS } }],
        );
        this.trackers.set(target, id);
      }
    }
    this.activeIndexState.set(-1);
    this.recompute();
  }

  /**
   * Selects the match at the given index, bringing its editor forward and revealing it there.
   * @param index The zero-based index of the match to select.
   */
  public select(index: number): void {
    const match: FlatMatch | undefined = this.flat[index];
    if (match === undefined) {
      return;
    }
    this.activeIndexState.set(index);
    void this.reveal(match);
  }

  /**
   * Selects the next match, stopping at the last.
   */
  public next(): void {
    const index: number = this.activeIndexState() + 1;
    if (index < this.flat.length) {
      this.select(index);
    }
  }

  /**
   * Selects the previous match, stopping at the first.
   */
  public previous(): void {
    const index: number = this.activeIndexState() - 1;
    if (index >= 0) {
      this.select(index);
    }
  }

  /**
   * Replaces the active match.
   * @param replacement The text to replace it with.
   */
  public replace(replacement: string): void {
    this.replaceMatch(replacement);
  }

  /**
   * Replaces every match that can be changed.
   * @param replacement The text to replace each match with.
   */
  public replaceAll(replacement: string): void {
    this.replaceEvery(replacement);
  }

  /**
   * Undoes the most recent replace in every model it changed, and searches again.
   */
  public undo(): void {
    const stack: readonly (readonly MonacoApi.editor.ITextModel[])[] = this.undoStack();
    const last: readonly MonacoApi.editor.ITextModel[] | undefined = stack.at(-1);
    if (last === undefined) {
      return;
    }
    for (const model of last) {
      if (!model.isDisposed()) {
        void model.undo();
      }
    }
    this.undoStack.set(stack.slice(0, -1));
    this.recompute();
  }

  /**
   * Gets whether the active match can be replaced: one is active, and it is not in a read-only editor
   * (a diff, a generated listing, a response body).
   * @returns Returns true when Replace can change the active match.
   */
  public activeReplaceable(): boolean {
    const match: FlatMatch | undefined = this.flat[this.activeIndexState()];
    return match !== undefined && match.target.readOnly !== true;
  }

  /**
   * Gets whether any match can be replaced: at least one is outside a diff.
   * @returns Returns true when Replace All has something to change.
   */
  public hasReplaceable(): boolean {
    return this.flat.some((match: FlatMatch): boolean => match.target.readOnly !== true);
  }

  /**
   * Replaces the active match as an editor edit, searches again, and selects the match that now takes
   * its place — so pressing Replace again moves on through the matches.
   * @param replacement The text to replace the match with.
   * @returns Returns what was replaced, or null when there was no active match.
   */
  public replaceMatch(replacement: string): ReplaceResponse | null {
    const index: number = this.activeIndexState();
    const match: FlatMatch | undefined = this.flat[index];
    if (match === undefined) {
      return null;
    }
    const { target } = match;
    if (target.readOnly === true) {
      return refused(target.path, 'It is read-only, so it cannot be edited.');
    }
    if (target.model.isDisposed()) {
      this.recompute();
      return refused(target.path, 'It is no longer open.');
    }
    if (target.model.getVersionId() !== match.version) {
      // The text moved on since the search, so the range may cover something else now: search again
      // rather than replace blind.
      this.recompute();
      return refused(target.path, 'It changed since the search, so the results were refreshed.');
    }
    this.edit(target.model, [
      { range: match.range, text: this.replacementFor(match, replacement), forceMoveMarkers: true },
    ]);
    this.undoStack.update(
      (
        stack: readonly (readonly MonacoApi.editor.ITextModel[])[],
      ): readonly (readonly MonacoApi.editor.ITextModel[])[] => [...stack, [target.model]],
    );
    this.recompute();
    if (this.flat.length > 0) {
      this.select(Math.min(index, this.flat.length - 1));
    } else {
      this.activeIndexState.set(-1);
    }
    return { replaced: 1, files: 1, failed: [] };
  }

  /**
   * Replaces every match outside a diff, as one edit per model, and searches again. Each model's
   * matches are found afresh first, so an edit made since the search is replaced as it now stands.
   * @param replacement The text to replace each match with.
   * @returns Returns what was replaced, or null when there was nothing to replace.
   */
  public replaceEvery(replacement: string): ReplaceResponse | null {
    const query: FindQuery | null = this.lastQuery;
    if (query === null || this.flat.length === 0) {
      return null;
    }
    const changed: MonacoApi.editor.ITextModel[] = [];
    let replaced: number = 0;
    for (const target of this.targets) {
      if (target.readOnly === true || target.model.isDisposed()) {
        continue;
      }
      const found: readonly FlatMatch[] = this.find(target, query, MAX_TOTAL_MATCHES);
      if (found.length === 0) {
        continue;
      }
      this.edit(
        target.model,
        found.map((match: FlatMatch): MonacoApi.editor.IIdentifiedSingleEditOperation => ({
          range: match.range,
          text: this.replacementFor(match, replacement),
          forceMoveMarkers: true,
        })),
      );
      changed.push(target.model);
      replaced += found.length;
    }
    if (changed.length > 0) {
      this.undoStack.update(
        (
          stack: readonly (readonly MonacoApi.editor.ITextModel[])[],
        ): readonly (readonly MonacoApi.editor.ITextModel[])[] => [...stack, changed],
      );
    }
    this.activeIndexState.set(-1);
    this.recompute();
    return { replaced, files: changed.length, failed: [] };
  }

  /**
   * Replaces every match outside a read-only editor. Nothing needs skipping: an editor edit is what
   * an editor's unsaved edits already are.
   * @param replacement The text to replace each match with.
   * @returns Returns what was replaced, or null when there was nothing to replace.
   */
  public replaceFiles(replacement: string): ReplaceResponse | null {
    return this.replaceEvery(replacement);
  }

  /**
   * Gets the absolute path of the active match's file, or null when no match is active.
   * @returns Returns the path, or null.
   */
  public activePath(): string | null {
    return this.flat[this.activeIndexState()]?.target.path ?? null;
  }

  /**
   * Gets the absolute paths of the files with matches, in the order they were found.
   * @returns Returns the paths.
   */
  public paths(): readonly string[] {
    return [...new Set<string>(this.flat.map((match: FlatMatch): string => match.target.path))];
  }

  /**
   * Clears the query, the matches and their highlights.
   */
  public clear(): void {
    this.lastQuery = null;
    this.untrack();
    this.targets = [];
    this.flat = [];
    this.undoStack.set([]);
    this.activeIndexState.set(-1);
    this.paint();
    this.matchesState.set([]);
  }

  /**
   * Finds the matches in every target and repaints the highlights.
   */
  private recompute(): void {
    const query: FindQuery | null = this.lastQuery;
    const flat: FlatMatch[] = [];
    if (query !== null && query.text.length > 0) {
      for (const target of this.targets) {
        if (flat.length >= MAX_TOTAL_MATCHES) {
          break;
        }
        if (!target.model.isDisposed()) {
          flat.push(...this.find(target, query, MAX_TOTAL_MATCHES - flat.length));
        }
      }
    }
    this.flat = flat;
    this.paint();
    this.matchesState.set(flat.map((match: FlatMatch): FindResultItem => match.item));
  }

  /**
   * Finds the query's matches in one target, within its pinned range when it has one.
   * @param target The target.
   * @param query The query.
   * @param limit The most matches to return.
   * @returns Returns the matches, in document order.
   */
  private find(target: EditorSearchTarget, query: FindQuery, limit: number): FlatMatch[] {
    const { model } = target;
    const tracker: string | undefined = this.trackers.get(target);
    let scope: MonacoApi.IRange = model.getFullModelRange();
    if (tracker !== undefined) {
      const pinned: MonacoApi.IRange | null = model.getDecorationRange(tracker);
      if (pinned === null) {
        return [];
      }
      scope = pinned;
    }
    const found: MonacoApi.editor.FindMatch[] = model.findMatches(
      query.text,
      scope,
      query.regexp,
      query.caseSensitive,
      query.wholeWord ? WORD_SEPARATORS : null,
      query.regexp,
      limit,
    );
    const version: number = model.getVersionId();
    return found.map((match: MonacoApi.editor.FindMatch): FlatMatch => ({
      target,
      range: match.range,
      captures: match.matches,
      version,
      item: itemFor(model, match.range, target.label),
    }));
  }

  /**
   * Repaints every model's highlights to the current matches, clearing those of models that no longer
   * have any.
   */
  private paint(): void {
    const ranges: Map<MonacoApi.editor.ITextModel, MonacoApi.IRange[]> = new Map<
      MonacoApi.editor.ITextModel,
      MonacoApi.IRange[]
    >();
    for (const match of this.flat) {
      const list: MonacoApi.IRange[] = ranges.get(match.target.model) ?? [];
      list.push(match.range);
      ranges.set(match.target.model, list);
    }
    const models: Set<MonacoApi.editor.ITextModel> = new Set<MonacoApi.editor.ITextModel>([
      ...this.highlights.keys(),
      ...ranges.keys(),
    ]);
    for (const model of models) {
      if (model.isDisposed()) {
        this.highlights.delete(model);
        continue;
      }
      const next: string[] = model.deltaDecorations(
        this.highlights.get(model) ?? [],
        (ranges.get(model) ?? []).map(
          (range: MonacoApi.IRange): MonacoApi.editor.IModelDeltaDecoration => ({
            range,
            options: { className: 'findMatch' },
          }),
        ),
      );
      if (next.length > 0) {
        this.highlights.set(model, next);
      } else {
        this.highlights.delete(model);
      }
    }
  }

  /**
   * Removes the decorations pinning the limited targets' ranges.
   */
  private untrack(): void {
    for (const [target, id] of this.trackers) {
      if (!target.model.isDisposed()) {
        target.model.deltaDecorations([id], []);
      }
    }
    this.trackers.clear();
  }

  /**
   * Applies edits to a model as one undoable step of its own history, with nothing else folded in.
   * @param model The model.
   * @param edits The edits.
   */
  private edit(
    model: MonacoApi.editor.ITextModel,
    edits: MonacoApi.editor.IIdentifiedSingleEditOperation[],
  ): void {
    model.pushStackElement();
    model.pushEditOperations(null, edits, (): null => null);
    model.pushStackElement();
  }

  /**
   * Builds a match's replacement: the replacement as written for a literal query, or with the
   * pattern's groups filled in for a regular expression — `$1`, `$&`, `$$` and, for a match on one
   * line, `$<name>` — as the disk replace does.
   * @param match The match.
   * @param replacement The replacement as written.
   * @returns Returns the text to put in the match's place.
   */
  private replacementFor(match: FlatMatch, replacement: string): string {
    const query: FindQuery | null = this.lastQuery;
    if (query === null || !query.regexp || match.captures === null) {
      return replacement;
    }
    const whole: string = match.captures[0] ?? '';
    const named: Readonly<Record<string, string | undefined>> = namedGroupsFor(match, query, whole);
    return replacement.replace(
      /\$(\$|&|<([^>]+)>|(\d{1,2}))/g,
      (token: string, kind: string, name?: string, digits?: string): string => {
        if (kind === '$') {
          return '$';
        }
        if (kind === '&') {
          return whole;
        }
        if (name !== undefined) {
          return named[name] ?? '';
        }
        const group: number = Number(digits);
        return group >= 1 && group < match.captures!.length
          ? (match.captures![group] ?? '')
          : token;
      },
    );
  }

  /**
   * Brings a match's editor forward, then selects the match, centres it and gives the editor focus.
   *
   * The focus is what makes the move seen: the click that chose the match leaves focus in the results,
   * and an editor without focus draws neither its caret nor more than a faint selection — over a match
   * already highlighted like every other, so a match on screen looked as if nothing had happened.
   * @param match The match.
   */
  private async reveal(match: FlatMatch): Promise<void> {
    await match.target.activate?.();
    const editor: MonacoApi.editor.ICodeEditor | null = match.target.editor();
    if (editor?.getModel() !== match.target.model) {
      return;
    }
    editor.setSelection(match.range);
    editor.revealRangeInCenter(match.range);
    editor.focus();
  }
}

/**
 * Builds the response for a replace refused for one file.
 * @param path The file's absolute path.
 * @param reason Why, for the user.
 * @returns Returns the response.
 */
function refused(path: string, reason: string): ReplaceResponse {
  const failure: ReplaceFailure = { path, reason };
  return { replaced: 0, files: 0, failed: [failure] };
}

/**
 * Reads a match's named groups by running the pattern again at the match, on its line — Monaco's
 * captures carry the numbered groups only. Empty for a match spanning lines, or a pattern JavaScript
 * reads differently there.
 * @param match The match.
 * @param query The query.
 * @param whole The matched text.
 * @returns Returns the named groups' text, by name.
 */
function namedGroupsFor(
  match: FlatMatch,
  query: FindQuery,
  whole: string,
): Readonly<Record<string, string | undefined>> {
  if (match.range.startLineNumber !== match.range.endLineNumber) {
    return {};
  }
  try {
    const pattern: RegExp = new RegExp(query.text, query.caseSensitive ? 'y' : 'iy');
    pattern.lastIndex = match.range.startColumn - 1;
    const found: RegExpExecArray | null = pattern.exec(
      match.target.model.getLineContent(match.range.startLineNumber),
    );
    return found !== null && found[0] === whole ? (found.groups ?? {}) : {};
  } catch {
    return {};
  }
}

/**
 * Builds a match's row: its position, the matched text, and its line either side of it, trimmed.
 * @param model The model the match is in.
 * @param range The match's range.
 * @param label The file's label.
 * @returns Returns the row.
 */
function itemFor(
  model: MonacoApi.editor.ITextModel,
  range: MonacoApi.IRange,
  label: string,
): FindResultItem {
  const startLine: string = model.getLineContent(range.startLineNumber);
  const endLine: string = model.getLineContent(range.endLineNumber);
  const before: string = startLine.slice(
    Math.max(0, range.startColumn - 1 - PREVIEW_SIDE),
    range.startColumn - 1,
  );
  // A match spanning lines previews its first line only, as the disk search's rows do.
  const text: string =
    range.startLineNumber === range.endLineNumber
      ? model.getValueInRange(range)
      : startLine.slice(range.startColumn - 1);
  const after: string =
    range.startLineNumber === range.endLineNumber
      ? endLine.slice(range.endColumn - 1, range.endColumn - 1 + PREVIEW_SIDE)
      : '';
  return {
    line: range.startLineNumber,
    column: range.startColumn,
    before,
    text,
    after,
    file: label,
  };
}
