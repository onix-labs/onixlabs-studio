import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';

/**
 * Shows a key chord as the keys a person presses, each in its own key cap joined by a plus —
 * <kbd>⌘</kbd> + <kbd>⇧</kbd> + <kbd>T</kbd> on macOS, <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>T</kbd>
 * elsewhere. An empty chord shows nothing; the caller says what having no shortcut means.
 */
@Component({
  selector: 'app-chord-keys',
  templateUrl: './chord-keys.html',
  styleUrl: './chord-keys.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.role]': "spoken() === null ? null : 'img'",
    '[attr.aria-label]': 'spoken()',
  },
})
export class ChordKeys {
  /**
   * Holds the keybinding router, which labels the keys for the current platform.
   */
  private readonly keybindings: Keybindings = inject(Keybindings);

  /**
   * Gets the normalized chord to show (for example `Mod+Shift+T`).
   */
  public readonly chord: InputSignal<string> = input.required<string>();

  /**
   * Gets the chord's keys, labelled for the current platform.
   */
  protected readonly keys: Signal<readonly string[]> = computed((): readonly string[] =>
    this.keybindings.chordKeys(this.chord()),
  );

  /**
   * Gets the chord read as one phrase, for assistive technology, which would otherwise read the plus
   * signs between the key caps.
   */
  protected readonly spoken: Signal<string | null> = computed((): string | null =>
    this.keys().length === 0 ? null : this.keys().join(' '),
  );
}
