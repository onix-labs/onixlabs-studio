import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Keybindings, ResolvedBinding } from '@shared/angular/services/keybindings/keybindings';
import { ShortcutsOverlay } from '@shared/angular/services/shortcuts-overlay/shortcuts-overlay';

/**
 * Groups the overlay's rows under the view that owns them.
 */
interface ShortcutGroup {
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
 * Represents the keyboard-shortcuts cheat sheet: a modal listing the accelerators available right
 * now — the active view's bindings and the application-level ones — resolved to their effective
 * chords, so user overrides are reflected. Toggled by the shell's global shortcut and dismissable
 * with Escape or the backdrop.
 */
@Component({
  selector: 'app-shortcuts-overlay',
  imports: [Modal, ModalContent],
  templateUrl: './shortcuts-overlay-panel.html',
  styleUrl: './shortcuts-overlay-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShortcutsOverlayPanel {
  /**
   * Holds the overlay's visibility owner.
   */
  protected readonly overlay: ShortcutsOverlay = inject(ShortcutsOverlay);

  /**
   * Holds the keybinding router the available accelerators are read from.
   */
  private readonly keybindings: Keybindings = inject(Keybindings);

  /**
   * Gets the currently available bindings grouped under their owning view, in registration order.
   */
  protected readonly groups: Signal<readonly ShortcutGroup[]> = computed(
    (): readonly ShortcutGroup[] => {
      const groups: Map<string, ResolvedBinding[]> = new Map<string, ResolvedBinding[]>();
      for (const binding of this.keybindings.activeBindings()) {
        groups.set(binding.view, [...(groups.get(binding.view) ?? []), binding]);
      }
      return [...groups.entries()].map(
        ([view, bindings]: [string, ResolvedBinding[]]): ShortcutGroup => ({ view, bindings }),
      );
    },
  );

  /**
   * Formats a chord for the current platform.
   * @param chord The normalized chord.
   * @returns Returns the platform-formatted chord.
   */
  protected format(chord: string): string {
    return this.keybindings.formatChord(chord);
  }
}
