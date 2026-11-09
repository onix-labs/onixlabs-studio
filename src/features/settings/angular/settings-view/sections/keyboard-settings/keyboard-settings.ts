import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { Keybindings, ResolvedBinding } from '@shared/angular/services/keybindings/keybindings';
import { Log } from '@shared/angular/services/log/log';
import { Button } from '@shared/angular/components/forms/button/button';
import { ChordKeys } from '@shared/angular/components/chord-keys/chord-keys';
import { Icon } from '@shared/angular/icons/icon';
import { ChordModal } from './chord-modal/chord-modal';

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
 * Represents a Keyboard page of the settings view: one capability's catalogued commands (its
 * {@link view}), or the app-wide ones on Application › Keyboard, each showing its chord as key caps.
 *
 * Set Chord opens the {@link ChordModal}, which reads the new key combination; what it accepts
 * persists through the keybinding router into the `keyboard.overrides` setting and takes effect
 * immediately. Overridden chords show Reset, which restores the default; two commands that can be
 * live together resolving to the same chord are surfaced as a conflict, which dispatch resolves.
 */
@Component({
  selector: 'app-keyboard-settings',
  imports: [Button, ChordKeys, ChordModal],
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
   * Holds the command the Set Chord dialog is open for, or undefined while it is closed.
   */
  protected readonly picking: WritableSignal<ResolvedBinding | undefined> = signal<
    ResolvedBinding | undefined
  >(undefined);

  /**
   * Exposes the icon tokens to the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the catalogue view whose shortcuts the page shows, or null for Application › Keyboard: the
   * shortcuts that belong to no one capability.
   */
  public readonly view: InputSignal<string | null> = input.required<string | null>();

  /**
   * Gets the page's catalogued commands grouped under their owning view, in contribution order. A
   * capability's page holds a single group; the app-wide page holds the application menu's own
   * commands (Open File, Settings, Close Tab).
   */
  protected readonly groups: Signal<readonly BindingGroup[]> = computed(
    (): readonly BindingGroup[] => {
      const view: string | null = this.view();
      const groups: Map<string, ResolvedBinding[]> = new Map<string, ResolvedBinding[]>();
      for (const binding of this.keybindings.resolvedCatalogue()) {
        if (view === null ? !binding.global : binding.view !== view) {
          continue;
        }
        groups.set(binding.view, [...(groups.get(binding.view) ?? []), binding]);
      }
      return [...groups.entries()].map(
        ([view, bindings]: [string, ResolvedBinding[]]): BindingGroup => ({ view, bindings }),
      );
    },
  );

  /**
   * Gets the command ids whose effective chords collide within their view, or with an application-wide
   * command.
   */
  protected readonly conflicts: Signal<ReadonlySet<string>> = this.keybindings.conflictedIds;

  /**
   * Opens the Set Chord dialog for a command.
   * @param binding The command whose chord to set.
   */
  protected setChord(binding: ResolvedBinding): void {
    this.log.trace('settings.keyboard', 'Set Chord opened', binding.id);
    this.picking.set(binding);
  }

  /**
   * Restores a command's default chord.
   * @param id The catalogued command identifier.
   */
  protected reset(id: string): void {
    this.log.info('settings.keyboard', 'Keybinding reset to default', id);
    this.keybindings.clearOverride(id);
  }
}
