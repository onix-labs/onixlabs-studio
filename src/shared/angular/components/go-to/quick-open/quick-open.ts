import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  OnInit,
  output,
  OutputEmitterRef,
  Signal,
  viewChild,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { ListRow, ListView } from '@shared/angular/components/list-view/list-view';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import type {
  GoToSurfaceMode,
  GoToSymbol,
  GoToTarget,
} from '@shared/angular/services/go-to/go-to-model';
import { GoToPicker } from '../go-to-picker';

/**
 * Studio's quick-open box (#1009): a light box near the top of the editor's window that asks where to
 * go in the document, the "Quick-open box" Go to style.
 *
 * In symbol mode it lists the document's symbols — each with its kind's icon and what it is declared
 * in — filtering as you type; ↑ and ↓ move through them and Enter (or a click) goes to the one
 * selected. In line mode it takes a line, or `line:column`, and says which lines there are. In rename
 * mode (#1015) it opens holding the symbol's name, selected, and takes the new one. Escape, or a click
 * outside, dismisses it. It decides nothing about the editor: it reports where to go, or the new
 * name, and whoever opened it acts on that.
 */
@Component({
  selector: 'app-quick-open',
  imports: [AppIcon, ListView, TextField],
  templateUrl: './quick-open.html',
  styleUrl: './quick-open.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuickOpen implements OnInit {
  /**
   * Gets what the box asks for: a symbol, a line, or a new name.
   */
  public readonly mode: InputSignal<GoToSurfaceMode> = input<GoToSurfaceMode>('symbol');

  /**
   * Gets the name of the symbol being renamed, which a rename box opens holding (#1015).
   */
  public readonly currentName: InputSignal<string> = input<string>('');

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
   * Emitted with the new name when one is entered in rename mode (#1015).
   */
  public readonly renamed: OutputEmitterRef<string> = output<string>();

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
    (): string => this.currentName(),
  );

  /**
   * Gets the field's placeholder for the mode.
   */
  protected readonly placeholder: Signal<string> = computed((): string => {
    switch (this.mode()) {
      case 'line':
        return 'Line number, or line:column';
      case 'rename':
        return 'New name';
      default:
        return 'Go to a symbol in this file';
    }
  });

  /**
   * Gets the box's accessible name for the mode.
   */
  protected readonly label: Signal<string> = computed((): string => {
    switch (this.mode()) {
      case 'line':
        return 'Go to Line';
      case 'rename':
        return 'Rename Symbol';
      default:
        return 'Go to Symbol';
    }
  });

  /**
   * Gets the field's accessible name for the mode.
   */
  protected readonly fieldLabel: Signal<string> = computed((): string => {
    switch (this.mode()) {
      case 'line':
        return 'Line, or line:column';
      case 'rename':
        return 'New name';
      default:
        return 'Symbol name';
    }
  });

  /**
   * Gets whether a rename box's hint says what is wrong: something is typed, but no new name.
   */
  protected readonly renameInvalid: Signal<boolean> = computed(
    (): boolean => this.picker.renameEntry().name === null && this.picker.query().trim().length > 0,
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
   * Fills a rename box with the symbol's name, which the field selects as it is focused, so typing
   * replaces it.
   */
  public ngOnInit(): void {
    if (this.mode() === 'rename') {
      this.picker.query.set(this.currentName());
    }
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
   * Goes where Enter says: the selected symbol, or the typed line — or, renaming, gives the typed name.
   * Does nothing while what was typed names nowhere, or no new name, so it can be corrected rather
   * than lost.
   *
   * ⛔ The key is cancelled first. Going somewhere focuses the editor while Enter is still being
   * handled, and an Enter left to run its course lands there: a newline typed over the symbol just
   * selected, or under the line just reached — which also moved the caret one line down.
   * @param event The Enter key's event.
   */
  protected commit(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.mode() === 'rename') {
      const name: string | null = this.picker.renameEntry().name;
      if (name !== null) {
        this.renamed.emit(name);
      }
      return;
    }
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
