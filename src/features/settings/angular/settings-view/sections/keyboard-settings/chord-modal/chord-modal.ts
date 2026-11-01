import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  EffectCleanupRegisterFn,
  inject,
  input,
  InputSignal,
  linkedSignal,
  output,
  OutputEmitterRef,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { ChordKeys } from '@shared/angular/components/chord-keys/chord-keys';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { AppMenu } from '@shared/angular/services/app-menu/app-menu';
import { Keybindings, ResolvedBinding } from '@shared/angular/services/keybindings/keybindings';
import { Log } from '@shared/angular/services/log/log';

/**
 * Represents the Set Chord dialog: it reads the next key combination pressed and shows it as key caps,
 * for one catalogued command.
 *
 * Nothing changes until Accept. Clear empties the reading, so accepting it leaves the command with no
 * shortcut; Cancel (or Escape) leaves everything as it was. Enter accepts rather than being read, and
 * Tab moves to the buttons, so neither can be chosen as a shortcut on its own. While the dialog is
 * open the application menu stands its shortcuts down, so ⌘W or ⌘O is read as the new shortcut rather
 * than closing the tab or opening a file.
 */
@Component({
  selector: 'app-chord-modal',
  imports: [Button, ButtonRow, ChordKeys, Modal, ModalContent],
  templateUrl: './chord-modal.html',
  styleUrl: './chord-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChordModal {
  /**
   * Holds the keybinding router that reads, validates and persists the chord.
   */
  private readonly keybindings: Keybindings = inject(Keybindings);

  /**
   * Holds the application menu, whose shortcuts stand down while the dialog reads a chord.
   */
  private readonly menu: AppMenu = inject(AppMenu);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the command whose chord is being set, or undefined while the dialog is closed.
   */
  public readonly binding: InputSignal<ResolvedBinding | undefined> = input.required<
    ResolvedBinding | undefined
  >();

  /**
   * Emitted when the dialog closes, whether the chord was accepted or not.
   */
  public readonly closed: OutputEmitterRef<void> = output<void>();

  /**
   * Holds the chord read so far, starting from the command's current one; empty after Clear.
   */
  protected readonly captured: WritableSignal<string> = linkedSignal<string>(
    (): string => this.binding()?.chord ?? '',
  );

  /**
   * Gets why the chord read cannot be accepted, or null when it can. Having no shortcut is always
   * acceptable.
   */
  protected readonly rejection: Signal<string | null> = computed((): string | null => {
    const binding: ResolvedBinding | undefined = this.binding();
    const chord: string = this.captured();
    return binding === undefined || chord === ''
      ? null
      : this.keybindings.validateOverride(binding.id, chord);
  });

  /**
   * Initializes a new instance of the {@link ChordModal} class, standing the menu's shortcuts down for
   * as long as the dialog is open.
   */
  public constructor() {
    effect((onCleanup: EffectCleanupRegisterFn): void => {
      if (this.binding() !== undefined) {
        onCleanup(this.menu.suspendShortcuts());
      }
    });
  }

  /**
   * Reads a key press as the new chord. Escape is left to the dialog (it cancels), Tab to focus, and a
   * plain Enter accepts; a lone modifier waits for the key it goes with.
   * @param event The keyboard event.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' || event.key === 'Tab') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (
      event.key === 'Enter' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      this.accept();
      return;
    }
    const chord: string | null = this.keybindings.chordFromEvent(event);
    if (chord !== null) {
      this.log.trace('settings.keyboard', 'Chord read', chord);
      this.captured.set(chord);
    }
  }

  /**
   * Empties the reading, so accepting leaves the command with no shortcut.
   */
  protected clear(): void {
    this.captured.set('');
  }

  /**
   * Applies the chord read and closes: the default restores the default, an empty reading clears the
   * shortcut, and anything else becomes the command's override.
   */
  protected accept(): void {
    const binding: ResolvedBinding | undefined = this.binding();
    if (binding === undefined || this.rejection() !== null) {
      return;
    }
    const chord: string = this.captured();
    if (chord === binding.defaultChord) {
      this.keybindings.clearOverride(binding.id);
    } else if (chord === '') {
      this.keybindings.clearChord(binding.id);
    } else {
      this.keybindings.setOverride(binding.id, chord);
    }
    this.log.info('settings.keyboard', 'Chord accepted', binding.id, chord);
    this.closed.emit();
  }

  /**
   * Closes without changing anything.
   */
  protected cancel(): void {
    this.closed.emit();
  }
}
