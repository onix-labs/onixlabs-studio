import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
  viewChild,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { ListRow, ListView } from '@shared/angular/components/list-view/list-view';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import type { GoToMode, GoToSymbol, GoToTarget } from '@shared/angular/services/go-to/go-to-model';
import { GoToPicker } from '../go-to-picker';

/**
 * Studio's quick-open box (#1009): a light box near the top of the editor's window that asks where to
 * go in the document, the "Quick-open box" Go to style.
 *
 * In symbol mode it lists the document's symbols — each with its kind's icon and what it is declared
 * in — filtering as you type; ↑ and ↓ move through them and Enter (or a click) goes to the one
 * selected. In line mode it takes a line, or `line:column`, and says which lines there are. Escape,
 * or a click outside, dismisses it. It decides nothing about the editor: it reports where to go, and
 * whoever opened it goes there.
 */
@Component({
  selector: 'app-quick-open',
  imports: [AppIcon, ListView, TextField],
  templateUrl: './quick-open.html',
  styleUrl: './quick-open.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuickOpen {
  /**
   * Gets what the box asks for: a symbol, or a line.
   */
  public readonly mode: InputSignal<GoToMode> = input<GoToMode>('symbol');

  /**
   * Gets the number of lines in the document, the range a line must fall in.
   */
  public readonly lineCount: InputSignal<number> = input<number>(1);

  /**
   * Gets the document's symbols, or null while they are being read.
   */
  public readonly symbols: InputSignal<readonly GoToSymbol[] | null> = input<
    readonly GoToSymbol[] | null
  >(null);

  /**
   * Emitted with where to go when a symbol or a line is chosen.
   */
  public readonly picked: OutputEmitterRef<GoToTarget> = output<GoToTarget>();

  /**
   * Emitted when the box is dismissed without going anywhere.
   */
  public readonly dismissed: OutputEmitterRef<void> = output<void>();

  /**
   * Holds the state behind the box: what was typed, and what it matches or names.
   */
  protected readonly picker: GoToPicker = new GoToPicker(
    (): readonly GoToSymbol[] | null => this.symbols(),
    (): number => this.lineCount(),
  );

  /**
   * Gets the field's placeholder for the mode.
   */
  protected readonly placeholder: Signal<string> = computed((): string =>
    this.mode() === 'line' ? 'Line number, or line:column' : 'Go to a symbol in this file',
  );

  /**
   * Holds the field, focused as the box opens so typing goes straight into it.
   */
  private readonly field: Signal<TextField | undefined> = viewChild(TextField);

  /**
   * Initializes a new instance of the {@link QuickOpen} class, focusing the field once it is drawn.
   */
  public constructor() {
    afterNextRender((): void => this.field()?.focus());
  }

  /**
   * Moves the selection through the symbols, keeping the caret where it is in the field.
   * @param event The arrow key's event.
   * @param step How far to move: 1 down, -1 up.
   */
  protected step(event: Event, step: number): void {
    event.preventDefault();
    this.picker.step(step);
  }

  /**
   * Goes where Enter says: the selected symbol, or the typed line. Does nothing while what was typed
   * names nowhere, so a mistyped line can be corrected rather than lost.
   *
   * ⛔ The key is cancelled first. Going somewhere focuses the editor while Enter is still being
   * handled, and an Enter left to run its course lands there: a newline typed over the symbol just
   * selected, or under the line just reached — which also moved the caret one line down.
   * @param event The Enter key's event.
   */
  protected commit(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const target: GoToTarget | null =
      this.mode() === 'line' ? this.picker.lineTarget() : this.picker.symbolTarget();
    if (target !== null) {
      this.picked.emit(target);
    }
  }

  /**
   * Goes to a clicked symbol.
   * @param row The clicked row, carrying its symbol.
   */
  protected pick(row: ListRow): void {
    this.picked.emit((row.data as GoToSymbol).target);
  }

  /**
   * Reads a row's symbol, for the row template.
   * @param row The row.
   * @returns Returns the symbol it carries.
   */
  protected symbolOf(row: ListRow): GoToSymbol {
    return row.data as GoToSymbol;
  }
}
