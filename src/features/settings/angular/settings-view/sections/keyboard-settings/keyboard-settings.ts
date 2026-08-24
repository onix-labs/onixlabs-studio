import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { Keybindings, ResolvedBinding } from '@shared/angular/services/keybindings/keybindings';
import { Log } from '@shared/angular/services/log/log';
import { Button } from '@shared/angular/components/forms/button/button';

/**
 * Groups the section's rows under the view that owns them.
 */
interface BindingGroup {
  /**
   * Gets the owning view's label.
   */
  readonly view: string;

  /**
   * Gets the group's resolved bindings.
   */
  readonly bindings: readonly ResolvedBinding[];
}

/**
 * Represents the Keyboard section of the settings view: every catalogued command grouped by its
 * owning view, each with an editable chord.
 *
 * Clicking a chord arms capture: the next key combination becomes the command's override (persisted
 * through the keybinding router into the `keyboard.overrides` setting and effective immediately),
 * Escape cancels, and Backspace or Delete restores the default. Overridden chords show a reset
 * affordance; two commands in one view resolving to the same chord are surfaced as a conflict, which
 * dispatch resolves by registration order.
 */
@Component({
  selector: 'app-keyboard-settings',
  imports: [Button],
  templateUrl: './keyboard-settings.html',
  styleUrls: ['../section.scss', './keyboard-settings.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KeyboardSettingsSection {
  /**
   * Holds the keybinding router that owns the catalogue, the overrides, and their validation.
   */
  private readonly keybindings: Keybindings = inject(Keybindings);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the id of the command whose chord is being captured, or null when none is.
   */
  private readonly editing: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the most recent rejected-override message, keyed to the command it was rejected for; null
   * when the last interaction was accepted.
   */
  private readonly rejection: WritableSignal<{ id: string; message: string } | null> = signal<{
    id: string;
    message: string;
  } | null>(null);

  /**
   * Gets the catalogued commands grouped under their owning view, in contribution order.
   */
  protected readonly groups: Signal<readonly BindingGroup[]> = computed(
    (): readonly BindingGroup[] => {
      const groups: Map<string, ResolvedBinding[]> = new Map<string, ResolvedBinding[]>();
      for (const binding of this.keybindings.resolvedCatalogue()) {
        groups.set(binding.view, [...(groups.get(binding.view) ?? []), binding]);
      }
      return [...groups.entries()].map(
        ([view, bindings]: [string, ResolvedBinding[]]): BindingGroup => ({ view, bindings }),
      );
    },
  );

  /**
   * Gets the command ids whose effective chords collide within their view.
   */
  protected readonly conflicts: Signal<ReadonlySet<string>> = this.keybindings.conflictedIds;

  /**
   * Determines whether a command's chord is being captured.
   * @param id The catalogued command identifier.
   * @returns Returns true while the command is armed for capture.
   */
  protected isEditing(id: string): boolean {
    return this.editing() === id;
  }

  /**
   * Gets the rejection message for a command, or null when its last interaction was accepted.
   * @param id The catalogued command identifier.
   * @returns Returns the human-readable rejection, or null.
   */
  protected rejectionFor(id: string): string | null {
    const rejection: { id: string; message: string } | null = this.rejection();
    return rejection !== null && rejection.id === id ? rejection.message : null;
  }

  /**
   * Formats a chord for the current platform.
   * @param chord The normalized chord.
   * @returns Returns the platform-formatted chord.
   */
  protected format(chord: string): string {
    return this.keybindings.formatChord(chord);
  }

  /**
   * Arms chord capture for a command.
   * @param id The catalogued command identifier.
   */
  protected beginCapture(id: string): void {
    this.log.trace('settings.keyboard', 'Chord capture armed', id);
    this.rejection.set(null);
    this.editing.set(id);
  }

  /**
   * Disarms chord capture (the capture button lost focus).
   */
  protected cancelCapture(): void {
    this.editing.set(null);
  }

  /**
   * Handles a key press while a command is armed for capture: Escape cancels, Backspace or Delete
   * restores the default, and any complete chord is validated and persisted as the override. The
   * event never propagates, so an armed capture cannot trigger the accelerator it spells.
   * @param event The keyboard event to capture.
   * @param id The catalogued command identifier being captured.
   */
  protected onCaptureKeydown(event: KeyboardEvent, id: string): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      this.editing.set(null);
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      this.log.info('settings.keyboard', 'Keybinding override cleared via capture', id);
      this.keybindings.clearOverride(id);
      this.editing.set(null);
      return;
    }
    const chord: string | null = this.keybindings.chordFromEvent(event);
    if (chord === null) {
      return;
    }
    const error: string | null = this.keybindings.setOverride(id, chord);
    this.log.info(
      'settings.keyboard',
      'Keybinding override applied',
      id,
      chord,
      error ?? 'accepted',
    );
    if (error !== null) {
      this.rejection.set({ id, message: error });
    }
    this.editing.set(null);
  }

  /**
   * Restores a command's default chord.
   * @param id The catalogued command identifier.
   */
  protected reset(id: string): void {
    this.log.info('settings.keyboard', 'Keybinding reset to default', id);
    this.rejection.set(null);
    this.keybindings.clearOverride(id);
  }
}
