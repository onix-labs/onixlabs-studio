import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  InputSignal,
  model,
  ModelSignal,
  output,
  OutputEmitterRef,
  Signal,
  viewChild,
} from '@angular/core';
import {
  TextField,
  TextFieldSelection,
} from '@shared/angular/components/forms/text-field/text-field';

/**
 * Names what a row edit field selects when it opens. `all` selects the whole value; `stem` selects a
 * file name without its extension, so typing replaces the name and keeps the `.ts`.
 */
export type RowEditSelection = 'all' | 'stem';

/**
 * Resolves the run of a file name that is its stem: everything before the last dot. A name with no
 * dot, or whose only dot leads it (`.gitignore`), is all stem — the dot there is part of the name, not
 * the start of an extension.
 * @param name The file name.
 * @returns Returns the stem's selection range.
 */
export function stemSelection(name: string): TextFieldSelection {
  const dot: number = name.lastIndexOf('.');
  return { start: 0, end: dot <= 0 ? name.length : dot };
}

/**
 * The field a tree or list row turns into while it is being named — renamed in place, or named for the
 * first time as a placeholder for something about to be created.
 *
 * It owns what naming in place means, so the presenters that host it cannot drift apart: it opens
 * focused with the name (or its stem) selected; Enter commits and Escape cancels; losing focus commits,
 * as clicking away does in other editors' trees. A commit whose trimmed name is empty, or unchanged from
 * the name the edit started with, is reported as abandoned instead — there is nothing to apply, and a
 * placeholder that was never named should simply go away. Only the first of those outcomes is reported:
 * Enter is followed by the blur of the field disappearing, and that blur must not commit twice.
 */
@Component({
  selector: 'app-row-edit-field',
  imports: [TextField],
  templateUrl: './row-edit-field.html',
  styleUrl: './row-edit-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RowEditField {
  /**
   * Gets or sets the name being typed. A model rather than internal state, so a presenter whose rows
   * are recycled (a virtual scroller) can keep the draft across the field being rebuilt.
   */
  public readonly value: ModelSignal<string> = model<string>('');

  /**
   * Gets the name the edit started from, against which an unchanged commit is recognised.
   */
  public readonly initial: InputSignal<string> = input<string>('');

  /**
   * Gets what the field selects when it opens.
   */
  public readonly selection: InputSignal<RowEditSelection> = input<RowEditSelection>('all');

  /**
   * Gets the accessible name of the field.
   */
  public readonly ariaLabel: InputSignal<string> = input<string>('Name');

  /**
   * Emits the trimmed name when the edit is committed with something to apply.
   */
  public readonly commit: OutputEmitterRef<string> = output<string>();

  /**
   * Emits when the edit is abandoned, or committed with nothing to apply.
   */
  public readonly abandon: OutputEmitterRef<void> = output<void>();

  /**
   * Holds the text field the name is typed into.
   */
  private readonly field: Signal<TextField | undefined> = viewChild(TextField);

  /**
   * Holds the host element, so a blur can tell whether the field is still in the document.
   */
  private readonly host: ElementRef<HTMLElement> = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Holds whether this edit has already been reported, so the blur that follows Enter or Escape (the
   * field is removed once the edit ends) cannot report it a second time.
   */
  private settled: boolean = false;

  /**
   * Initializes a new instance of the {@link RowEditField} class, focusing the field once it has
   * rendered and selecting the name (or its stem) so the first keystroke replaces it.
   */
  public constructor() {
    afterNextRender((): void => {
      const value: string = this.value();
      this.field()?.focus(this.selection() === 'stem' ? stemSelection(value) : undefined);
    });
  }

  /**
   * Commits the edit: applies the trimmed name, or cancels when there is nothing to apply.
   */
  protected onEnter(): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    const name: string = this.value().trim();
    if (name.length === 0 || name === this.initial()) {
      this.abandon.emit();
      return;
    }
    this.commit.emit(name);
  }

  /**
   * Abandons the edit.
   */
  protected onEscape(): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.abandon.emit();
  }

  /**
   * Commits the edit when focus leaves the field — unless the field is leaving the document, which is
   * not the user clicking away: a virtual scroller recycling the row, or the host tearing it down.
   */
  protected onBlur(): void {
    if (!this.host.nativeElement.isConnected) {
      return;
    }
    this.onEnter();
  }

  /**
   * Stops an event the row beneath answers — a click, Enter, Space — from reaching it, where it would
   * select, toggle or open the entry being named, or swallow the space being typed.
   * @param event The key or pointer event.
   */
  protected swallow(event: Event): void {
    event.stopPropagation();
  }
}
