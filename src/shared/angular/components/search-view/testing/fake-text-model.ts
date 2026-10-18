import type * as MonacoApi from 'monaco-editor';

/**
 * A Monaco text model over an in-memory buffer, for tests of what searches and edits open editors
 * (#1007). `findMatches` genuinely scans the text within its scope and `pushEditOperations` genuinely
 * rewrites it, with an undo stack behind `undo`, so a replace really drops the match it consumed and an
 * undo really brings it back. Edits stay on one line, as a find's matches do in these tests; tracked
 * decorations do not move with edits.
 */
export class FakeTextModel {
  /**
   * Holds the buffer's lines.
   */
  private lines: string[];

  /**
   * Holds the buffer before each edit, newest last.
   */
  private readonly history: string[][] = [];

  /**
   * Holds the decorations, by id.
   */
  private readonly decorations: Map<string, MonacoApi.editor.IModelDeltaDecoration> = new Map<
    string,
    MonacoApi.editor.IModelDeltaDecoration
  >();

  /**
   * Holds the next decoration id.
   */
  private nextDecoration: number = 0;

  /**
   * Holds the version, bumped by each edit.
   */
  private version: number = 1;

  /**
   * Holds whether the model has been disposed.
   */
  public disposed: boolean = false;

  /**
   * Initializes a new instance of the {@link FakeTextModel} class.
   * @param initial The buffer's initial lines.
   */
  public constructor(initial: readonly string[]) {
    this.lines = [...initial];
  }

  /**
   * Views the fake as the Monaco model it stands in for.
   * @returns Returns the fake, typed as a model.
   */
  public asModel(): MonacoApi.editor.ITextModel {
    return this as unknown as MonacoApi.editor.ITextModel;
  }

  /**
   * Gets the buffer's text.
   * @returns Returns the lines joined by newlines.
   */
  public text(): string {
    return this.lines.join('\n');
  }

  /**
   * Gets the ranges highlighted as find matches.
   * @returns Returns the ranges.
   */
  public highlights(): readonly MonacoApi.IRange[] {
    return [...this.decorations.values()]
      .filter(
        (decoration: MonacoApi.editor.IModelDeltaDecoration): boolean =>
          decoration.options.className === 'findMatch',
      )
      .map(
        (decoration: MonacoApi.editor.IModelDeltaDecoration): MonacoApi.IRange => decoration.range,
      );
  }

  /**
   * Replaces the buffer, as a user typing would, bumping the version.
   * @param lines The new lines.
   */
  public type(lines: readonly string[]): void {
    this.lines = [...lines];
    this.version += 1;
  }

  /**
   * Gets the model's version.
   * @returns Returns the version.
   */
  public getVersionId(): number {
    return this.version;
  }

  /**
   * Gets whether the model has been disposed.
   * @returns Returns true once disposed.
   */
  public isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Gets a line's text.
   * @param lineNumber The one-based line.
   * @returns Returns the text.
   */
  public getLineContent(lineNumber: number): string {
    return this.lines[lineNumber - 1] ?? '';
  }

  /**
   * Gets the text in a one-line range.
   * @param range The range.
   * @returns Returns the text.
   */
  public getValueInRange(range: MonacoApi.IRange): string {
    return this.getLineContent(range.startLineNumber).slice(
      range.startColumn - 1,
      range.endColumn - 1,
    );
  }

  /**
   * Gets the range covering the whole buffer.
   * @returns Returns the range.
   */
  public getFullModelRange(): MonacoApi.IRange {
    return {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: this.lines.length,
      endColumn: this.getLineContent(this.lines.length).length + 1,
    };
  }

  /**
   * Finds a query's matches within a scope, line by line.
   * @param searchString The text or pattern.
   * @param scope The range to search within.
   * @param isRegex Whether the text is a pattern.
   * @param matchCase Whether case matters.
   * @param wordSeparators The word separators for a whole-word search, or null.
   * @param captureMatches Whether to return each match's captures.
   * @param limit The most matches to return.
   * @returns Returns the matches.
   */
  public findMatches(
    searchString: string,
    scope: MonacoApi.IRange,
    isRegex: boolean,
    matchCase: boolean,
    wordSeparators: string | null,
    captureMatches: boolean,
    limit: number = Number.MAX_SAFE_INTEGER,
  ): MonacoApi.editor.FindMatch[] {
    const body: string = isRegex
      ? searchString
      : searchString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const source: string = wordSeparators !== null ? `\\b(?:${body})\\b` : body;
    const pattern: RegExp = new RegExp(source, `g${matchCase ? '' : 'i'}`);
    const found: MonacoApi.editor.FindMatch[] = [];
    for (let line: number = scope.startLineNumber; line <= scope.endLineNumber; line++) {
      const text: string = this.getLineContent(line);
      const from: number = line === scope.startLineNumber ? scope.startColumn - 1 : 0;
      const to: number = line === scope.endLineNumber ? scope.endColumn - 1 : text.length;
      pattern.lastIndex = from;
      let match: RegExpExecArray | null = pattern.exec(text);
      while (match !== null && found.length < limit) {
        if (match[0].length === 0) {
          pattern.lastIndex = match.index + 1;
        } else if (match.index + match[0].length <= to) {
          found.push({
            range: {
              startLineNumber: line,
              startColumn: match.index + 1,
              endLineNumber: line,
              endColumn: match.index + 1 + match[0].length,
            },
            matches: captureMatches
              ? [...match].map((group: string | undefined) => group ?? '')
              : null,
          } as MonacoApi.editor.FindMatch);
        }
        match = pattern.exec(text);
      }
    }
    return found;
  }

  /**
   * Replaces decorations.
   * @param oldIds The decorations to remove.
   * @param added The decorations to add.
   * @returns Returns the added decorations' ids.
   */
  public deltaDecorations(
    oldIds: readonly string[],
    added: readonly MonacoApi.editor.IModelDeltaDecoration[],
  ): string[] {
    for (const id of oldIds) {
      this.decorations.delete(id);
    }
    return added.map((decoration: MonacoApi.editor.IModelDeltaDecoration): string => {
      const id: string = `d${this.nextDecoration++}`;
      this.decorations.set(id, decoration);
      return id;
    });
  }

  /**
   * Gets a decoration's range.
   * @param id The decoration's id.
   * @returns Returns the range, or null when there is no such decoration.
   */
  public getDecorationRange(id: string): MonacoApi.IRange | null {
    return this.decorations.get(id)?.range ?? null;
  }

  /**
   * Closes the current undo step (nothing to do: each edit is its own step here).
   */
  public pushStackElement(): void {
    // Each pushEditOperations is recorded as one step already.
  }

  /**
   * Applies one-line edits as one undoable step, bottom-up so none shifts another.
   * @param _before The selections before (unused).
   * @param edits The edits.
   * @returns Returns null.
   */
  public pushEditOperations(
    _before: unknown,
    edits: readonly MonacoApi.editor.IIdentifiedSingleEditOperation[],
  ): null {
    this.history.push([...this.lines]);
    const ordered: MonacoApi.editor.IIdentifiedSingleEditOperation[] = [...edits].sort(
      (
        left: MonacoApi.editor.IIdentifiedSingleEditOperation,
        right: MonacoApi.editor.IIdentifiedSingleEditOperation,
      ): number =>
        right.range.startLineNumber - left.range.startLineNumber ||
        right.range.startColumn - left.range.startColumn,
    );
    for (const edit of ordered) {
      const index: number = edit.range.startLineNumber - 1;
      const text: string = this.lines[index];
      this.lines[index] =
        text.slice(0, edit.range.startColumn - 1) +
        (edit.text ?? '') +
        text.slice(edit.range.endColumn - 1);
    }
    this.version += 1;
    return null;
  }

  /**
   * Undoes the last edit.
   */
  public undo(): void {
    const previous: string[] | undefined = this.history.pop();
    if (previous !== undefined) {
      this.lines = previous;
      this.version += 1;
    }
  }

  /**
   * Gets whether there is an edit to undo.
   * @returns Returns true when there is.
   */
  public canUndo(): boolean {
    return this.history.length > 0;
  }
}

/**
 * An editor showing a {@link FakeTextModel}, recording what it was asked to select and reveal.
 */
export class FakeCodeEditor {
  /**
   * Holds the last selection set, or null.
   */
  public selection: MonacoApi.IRange | null = null;

  /**
   * Holds how many times a range was revealed.
   */
  public reveals: number = 0;

  /**
   * Holds the range last revealed, or null.
   */
  public revealed: MonacoApi.IRange | null = null;

  /**
   * Holds whether the editor has text focus.
   */
  public focused: boolean = false;

  /**
   * Holds whether the editor is read-only.
   */
  public readOnly: boolean = false;

  /**
   * Initializes a new instance of the {@link FakeCodeEditor} class.
   * @param model The model the editor shows.
   */
  public constructor(private readonly model: FakeTextModel) {}

  /**
   * Views the fake as the Monaco editor it stands in for.
   * @returns Returns the fake, typed as an editor.
   */
  public asEditor(): MonacoApi.editor.ICodeEditor {
    return this as unknown as MonacoApi.editor.ICodeEditor;
  }

  /**
   * Gets the model shown.
   * @returns Returns the model.
   */
  public getModel(): MonacoApi.editor.ITextModel {
    return this.model.asModel();
  }

  /**
   * Gets the editor's options as set: only whether it is read-only.
   * @returns Returns the options.
   */
  public getRawOptions(): MonacoApi.editor.IEditorOptions {
    return { readOnly: this.readOnly };
  }

  /**
   * Records a selection.
   * @param range The range.
   */
  public setSelection(range: MonacoApi.IRange): void {
    this.selection = range;
  }

  /**
   * Records a reveal, centred.
   * @param range The range revealed.
   */
  public revealRangeInCenter(range: MonacoApi.IRange): void {
    this.revealed = range;
    this.reveals += 1;
  }

  /**
   * Gives the editor text focus.
   */
  public focus(): void {
    this.focused = true;
  }

  /**
   * Gets whether the editor has text focus.
   * @returns Returns the focus.
   */
  public hasTextFocus(): boolean {
    return this.focused;
  }
}
