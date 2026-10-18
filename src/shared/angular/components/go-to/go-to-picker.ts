import { computed, linkedSignal, Signal, signal, WritableSignal } from '@angular/core';
import type { ListRow } from '@shared/angular/components/list-view/list-view';
import {
  filterSymbols,
  GoToSymbol,
  GoToTarget,
  LineEntry,
  lineHint,
  parseLineEntry,
  stepSelection,
} from '@shared/angular/services/go-to/go-to-model';

/**
 * Holds the state behind every Go to surface (#1009) — the quick-open box and both dialogs — so they
 * read what was typed, filter and step through symbols, and decide where Enter goes, the same way:
 * what was typed, the symbols it matches, the one selected, and the line it names.
 *
 * A plain class over signals rather than a service: each surface owns one for as long as it is open,
 * fed its document's line count and symbols.
 */
export class GoToPicker {
  /**
   * Holds what has been typed.
   */
  public readonly query: WritableSignal<string> = signal<string>('');

  /**
   * Gets the symbols matching what has been typed, best first, or empty while they are being read.
   */
  public readonly matches: Signal<readonly GoToSymbol[]> = computed((): readonly GoToSymbol[] =>
    filterSymbols(this.symbols() ?? [], this.query()),
  );

  /**
   * Gets the matching symbols as list rows, each carrying its symbol.
   */
  public readonly rows: Signal<readonly ListRow[]> = computed((): readonly ListRow[] =>
    this.matches().map((symbol: GoToSymbol): ListRow => ({ id: symbol.id, data: symbol })),
  );

  /**
   * Holds the selected symbol's identifier: the best match whenever the matches change, then wherever
   * the arrow keys move it.
   */
  public readonly selectedId: WritableSignal<string | null> = linkedSignal<string | null>(
    (): string | null => this.matches()[0]?.id ?? null,
  );

  /**
   * Gets the line what has been typed names, or why it names none.
   */
  public readonly lineEntry: Signal<LineEntry> = computed((): LineEntry =>
    parseLineEntry(this.query(), this.lineCount()),
  );

  /**
   * Gets the hint shown under a Go to Line field.
   */
  public readonly lineHint: Signal<string> = computed((): string =>
    lineHint(this.lineEntry(), this.lineCount()),
  );

  /**
   * Gets why the symbol list is empty, or an empty string when it is not.
   */
  public readonly emptyText: Signal<string> = computed((): string => {
    if ((this.symbols() ?? []).length === 0) {
      return 'No symbols in this file';
    }
    return this.matches().length === 0 ? `No symbols match “${this.query().trim()}”` : '';
  });

  /**
   * Initializes a new instance of the {@link GoToPicker} class.
   * @param symbols Reads the document's symbols, or null while they are being read.
   * @param lineCount Reads the number of lines in the document.
   */
  public constructor(
    private readonly symbols: () => readonly GoToSymbol[] | null,
    private readonly lineCount: () => number,
  ) {}

  /**
   * Moves the selection through the matching symbols.
   * @param step How far to move: 1 down, -1 up.
   */
  public step(step: number): void {
    const ids: readonly string[] = this.matches().map((symbol: GoToSymbol): string => symbol.id);
    this.selectedId.set(stepSelection(ids, this.selectedId(), step));
  }

  /**
   * Gets where going to the selected symbol lands.
   * @returns Returns the selected symbol's target, or null when none is selected.
   */
  public symbolTarget(): GoToTarget | null {
    const id: string | null = this.selectedId();
    return this.matches().find((symbol: GoToSymbol): boolean => symbol.id === id)?.target ?? null;
  }

  /**
   * Gets where the typed line lands: its column, or the line's start when none was typed.
   * @returns Returns the target, or null when what was typed names no line.
   */
  public lineTarget(): GoToTarget | null {
    const entry: LineEntry = this.lineEntry();
    return entry.kind === 'valid' ? { line: entry.line, column: entry.column ?? 1 } : null;
  }
}
