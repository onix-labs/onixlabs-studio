import type * as MonacoApi from 'monaco-editor';
import {
  ConflictBlock,
  ConflictChoice,
  choiceForSide,
  parseConflicts,
  resolveConflictLines,
} from '@shared/angular/services/repository/conflict-resolution';

/**
 * How long the lens waits after an edit before reading the file again, so typing does not re-parse on
 * every keystroke.
 */
const REFRESH_DELAY_MS: number = 120;

/**
 * Colours a conflict's mark in the overview ruler. A fixed colour, because the ruler is drawn on a canvas
 * that cannot read the theme's CSS variables: the warning orange, which reads on both themes.
 */
const RULER_COLOUR: string = 'rgba(253, 126, 20, 0.8)';

/**
 * What the lens shows on each conflict's row and how it maps the user's words onto git's sections.
 */
export interface ConflictLensLabels {
  /**
   * Gets the label of the command keeping the user's own work: "Keep main (Yours)".
   */
  readonly yours: string;

  /**
   * Gets the label of the command keeping the other side: "Keep feature/x (Theirs)".
   */
  readonly theirs: string;

  /**
   * Gets whether git wrote the user's own work below the divider (a rebase).
   */
  readonly swapped: boolean;
}

/**
 * What the lens asks of the editor that owns it.
 */
export interface ConflictLensHost {
  /**
   * Gets the labels for the rows, read each time the rows are drawn.
   * @returns Returns the labels.
   */
  labels(): ConflictLensLabels;

  /**
   * Gets whether the file is one git left conflicted, so its last resolved conflict is followed by an
   * offer to mark it resolved.
   * @returns Returns true when Mark Resolved applies.
   */
  canMarkResolved(): boolean;

  /**
   * Marks the file resolved.
   */
  markResolved(): void;

  /**
   * Hears how many conflicts the file holds whenever that changes.
   * @param count The number of conflicts.
   */
  countChanged(count: number): void;
}

/**
 * Describes the one edit that settles a conflict: the range it replaces, markers included, and what goes
 * there.
 */
export interface ConflictEdit {
  /**
   * Gets the range replaced, 1-based as Monaco counts.
   */
  readonly range: {
    readonly startLineNumber: number;
    readonly startColumn: number;
    readonly endLineNumber: number;
    readonly endColumn: number;
  };

  /**
   * Gets the text put in its place.
   */
  readonly text: string;
}

/**
 * Works out the edit that settles a conflict. The whole block is replaced line for line: when it is
 * not the file's last line, through the start of the line after it, so the kept lines keep their line
 * ending; when it is, from the end of the line before it, so nothing is left dangling.
 * @param lines The file's lines (the first is line 1).
 * @param eol The file's line ending.
 * @param block The conflict.
 * @param choice Which part to keep.
 * @returns Returns the edit.
 */
export function conflictEdit(
  lines: readonly string[],
  eol: string,
  block: ConflictBlock,
  choice: ConflictChoice,
): ConflictEdit {
  const kept: readonly string[] = resolveConflictLines(lines, block, choice);
  const lineCount: number = lines.length;
  if (block.end < lineCount) {
    return {
      range: {
        startLineNumber: block.start,
        startColumn: 1,
        endLineNumber: block.end + 1,
        endColumn: 1,
      },
      text: kept.length === 0 ? '' : `${kept.join(eol)}${eol}`,
    };
  }
  const endColumn: number = lines[block.end - 1].length + 1;
  if (kept.length === 0 && block.start > 1) {
    return {
      range: {
        startLineNumber: block.start - 1,
        startColumn: lines[block.start - 2].length + 1,
        endLineNumber: block.end,
        endColumn,
      },
      text: '',
    };
  }
  return {
    range: { startLineNumber: block.start, startColumn: 1, endLineNumber: block.end, endColumn },
    text: kept.join(eol),
  };
}

/**
 * Finds the conflict to move to from a line: the next one below it, or the previous one above it,
 * wrapping round at either end of the file.
 * @param blocks The file's conflicts, in order.
 * @param line The line the caret is on.
 * @param direction Which way to go.
 * @returns Returns the conflict, or null when the file has none.
 */
export function adjacentConflict(
  blocks: readonly ConflictBlock[],
  line: number,
  direction: 'next' | 'previous',
): ConflictBlock | null {
  if (blocks.length === 0) {
    return null;
  }
  if (direction === 'next') {
    return blocks.find((block: ConflictBlock): boolean => block.start > line) ?? blocks[0];
  }
  return (
    [...blocks].reverse().find((block: ConflictBlock): boolean => block.start < line) ??
    blocks[blocks.length - 1]
  );
}

/**
 * Draws a file's merge conflicts in the code editor and settles them (#1321): each conflict's sections
 * highlighted — the user's own work, the other side's, a diff3 base, and the markers — and above each a
 * row of Studio's own buttons: Keep Yours, Keep Theirs, Keep Both. Once a conflicted file has none left,
 * a row at its top offers Mark Resolved.
 *
 * The rows are Studio's DOM in Monaco view zones rather than any of Monaco's widgets (#946). Monaco
 * keeps a zone on its line as lines move above it, so the rows are rebuilt only when the number of
 * conflicts (or their labels) changes, not on every edit — a file with hundreds of conflicts stays
 * responsive while it is typed in. A click reads the file afresh and acts on the conflict in that
 * position, so a row can never act on a stale range.
 */
export class ConflictLens {
  /**
   * Holds the editor the lens draws in.
   */
  private readonly editor: MonacoApi.editor.IStandaloneCodeEditor;

  /**
   * Holds what the lens asks of its owner.
   */
  private readonly host: ConflictLensHost;

  /**
   * Holds the section and marker highlights.
   */
  private readonly decorations: MonacoApi.editor.IEditorDecorationsCollection;

  /**
   * Holds the ids of the rows drawn, to remove them when they are redrawn.
   */
  private zoneIds: string[] = [];

  /**
   * Holds the conflicts last read from the file.
   */
  private blocks: readonly ConflictBlock[] = [];

  /**
   * Holds what the rows were last drawn for, so they are redrawn only when it changes.
   */
  private drawnFor: string | null = null;

  /**
   * Holds the pending refresh after an edit, or null when none is waiting.
   */
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds the subscription to the editor's edits.
   */
  private readonly contentSubscription: MonacoApi.IDisposable;

  /**
   * Initializes a new instance of the {@link ConflictLens} class and draws the file's conflicts.
   * @param editor The editor to draw in.
   * @param host What the lens asks of its owner.
   */
  public constructor(editor: MonacoApi.editor.IStandaloneCodeEditor, host: ConflictLensHost) {
    this.editor = editor;
    this.host = host;
    this.decorations = editor.createDecorationsCollection([]);
    this.contentSubscription = editor.onDidChangeModelContent((): void => this.scheduleRefresh());
    this.refresh();
  }

  /**
   * Gets how many conflicts the file holds, as last read.
   * @returns Returns the count.
   */
  public count(): number {
    return this.blocks.length;
  }

  /**
   * Reads the file again and redraws: the highlights always, the rows only when what they show has
   * changed. Called after edits (debounced), and by the owner when the labels or the file's git state
   * change.
   */
  public refresh(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    const model: MonacoApi.editor.ITextModel | null = this.editor.getModel();
    const previousCount: number = this.blocks.length;
    this.blocks = model === null ? [] : parseConflicts(model.getValue());
    const labels: ConflictLensLabels = this.host.labels();
    this.decorations.set(this.highlights(labels));
    const offerResolve: boolean = this.blocks.length === 0 && this.host.canMarkResolved();
    const drawFor: string = `${this.blocks.length}|${labels.yours}|${labels.theirs}|${labels.swapped}|${offerResolve}`;
    if (drawFor !== this.drawnFor) {
      this.drawRows(labels, offerResolve);
      this.drawnFor = drawFor;
    }
    if (this.blocks.length !== previousCount) {
      this.host.countChanged(this.blocks.length);
    }
  }

  /**
   * Moves the caret to the next or previous conflict, wrapping round, and brings it into view.
   * @param direction Which way to go.
   * @returns Returns true when there was a conflict to move to.
   */
  public goTo(direction: 'next' | 'previous'): boolean {
    this.refresh();
    const line: number = this.editor.getPosition()?.lineNumber ?? 0;
    const target: ConflictBlock | null = adjacentConflict(this.blocks, line, direction);
    if (target === null) {
      return false;
    }
    this.editor.setPosition({ lineNumber: target.start, column: 1 });
    this.editor.revealLineInCenterIfOutsideViewport(target.start);
    this.editor.focus();
    return true;
  }

  /**
   * Settles the conflict in a position with one part of it, as one step on the undo stack.
   * @param index The conflict's position in the file, counting from 0.
   * @param choice Which part to keep.
   */
  public keep(index: number, choice: ConflictChoice): void {
    const model: MonacoApi.editor.ITextModel | null = this.editor.getModel();
    if (model === null) {
      return;
    }
    const lines: readonly string[] = model.getLinesContent();
    const block: ConflictBlock | undefined = parseConflicts(lines.join('\n'))[index];
    if (block === undefined) {
      return;
    }
    const edit: ConflictEdit = conflictEdit(lines, model.getEOL(), block, choice);
    this.editor.pushUndoStop();
    this.editor.executeEdits('conflict-lens', [{ range: edit.range, text: edit.text }]);
    this.editor.pushUndoStop();
    this.refresh();
  }

  /**
   * Removes everything the lens drew and stops following edits.
   */
  public dispose(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.contentSubscription.dispose();
    this.decorations.clear();
    this.editor.changeViewZones((accessor: MonacoApi.editor.IViewZoneChangeAccessor): void => {
      for (const id of this.zoneIds) {
        accessor.removeZone(id);
      }
    });
    this.zoneIds = [];
  }

  /**
   * Reads the file again a moment after the last edit.
   */
  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout((): void => this.refresh(), REFRESH_DELAY_MS);
  }

  /**
   * Builds the highlights for every conflict: its markers, the user's own section, the other side's,
   * and a diff3 base.
   * @param labels Which way round git wrote the sections.
   * @returns Returns the decorations.
   */
  private highlights(labels: ConflictLensLabels): MonacoApi.editor.IModelDeltaDecoration[] {
    const topClass: string = labels.swapped ? 'conflict-lens__theirs' : 'conflict-lens__yours';
    const bottomClass: string = labels.swapped ? 'conflict-lens__yours' : 'conflict-lens__theirs';
    const decorations: MonacoApi.editor.IModelDeltaDecoration[] = [];
    const lines: (from: number, to: number, className: string) => void = (
      from: number,
      to: number,
      className: string,
    ): void => {
      if (to >= from) {
        decorations.push({
          range: { startLineNumber: from, startColumn: 1, endLineNumber: to, endColumn: 1 },
          options: { isWholeLine: true, className },
        });
      }
    };
    for (const block of this.blocks) {
      for (const marker of [block.start, block.base, block.divider, block.end]) {
        if (marker !== null) {
          lines(marker, marker, 'conflict-lens__marker');
        }
      }
      lines(block.start + 1, (block.base ?? block.divider) - 1, topClass);
      if (block.base !== null) {
        lines(block.base + 1, block.divider - 1, 'conflict-lens__base');
      }
      lines(block.divider + 1, block.end - 1, bottomClass);
      decorations.push({
        range: {
          startLineNumber: block.start,
          startColumn: 1,
          endLineNumber: block.end,
          endColumn: 1,
        },
        options: {
          overviewRuler: { color: RULER_COLOUR, position: 7 /* OverviewRulerLane.Full */ },
        },
      });
    }
    return decorations;
  }

  /**
   * Redraws the rows: one above each conflict, or — once a conflicted file has none left — one at its
   * top offering Mark Resolved.
   * @param labels The labels to show.
   * @param offerResolve Whether to offer Mark Resolved.
   */
  private drawRows(labels: ConflictLensLabels, offerResolve: boolean): void {
    this.editor.changeViewZones((accessor: MonacoApi.editor.IViewZoneChangeAccessor): void => {
      for (const id of this.zoneIds) {
        accessor.removeZone(id);
      }
      this.zoneIds = [];
      if (offerResolve) {
        this.zoneIds.push(
          accessor.addZone({
            afterLineNumber: 0,
            heightInLines: 1,
            suppressMouseDown: true,
            domNode: this.row('No conflicts left in this file.', [
              { label: 'Mark Resolved', run: (): void => this.host.markResolved() },
            ]),
          }),
        );
        return;
      }
      this.blocks.forEach((block: ConflictBlock, index: number): void => {
        this.zoneIds.push(
          accessor.addZone({
            afterLineNumber: block.start - 1,
            heightInLines: 1,
            suppressMouseDown: true,
            domNode: this.row(null, [
              {
                label: labels.yours,
                run: (): void => this.keep(index, choiceForSide('yours', labels.swapped)),
              },
              {
                label: labels.theirs,
                run: (): void => this.keep(index, choiceForSide('theirs', labels.swapped)),
              },
              { label: 'Keep Both', run: (): void => this.keep(index, 'both') },
            ]),
          }),
        );
      });
    });
  }

  /**
   * Builds one row: an optional sentence, then its actions as Studio's quiet text buttons.
   * @param text The sentence, or null for none.
   * @param actions The actions, in order.
   * @returns Returns the row's element.
   */
  private row(
    text: string | null,
    actions: readonly { readonly label: string; readonly run: () => void }[],
  ): HTMLElement {
    const row: HTMLElement = document.createElement('div');
    row.className = 'conflict-lens';
    if (text !== null) {
      const sentence: HTMLElement = document.createElement('span');
      sentence.className = 'conflict-lens__text';
      sentence.textContent = text;
      row.append(sentence);
    }
    actions.forEach(
      (action: { readonly label: string; readonly run: () => void }, index: number): void => {
        if (index > 0 || text !== null) {
          const separator: HTMLElement = document.createElement('span');
          separator.className = 'conflict-lens__separator';
          separator.setAttribute('aria-hidden', 'true');
          separator.textContent = '·';
          row.append(separator);
        }
        const button: HTMLButtonElement = document.createElement('button');
        button.type = 'button';
        button.className = 'conflict-lens__action';
        button.textContent = action.label;
        button.addEventListener('click', (event: MouseEvent): void => {
          event.preventDefault();
          event.stopPropagation();
          action.run();
        });
        row.append(button);
      },
    );
    return row;
  }
}
