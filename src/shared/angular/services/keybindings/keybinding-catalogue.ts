import { InjectionToken, Provider } from '@angular/core';

/**
 * Describes one catalogued accelerator: the stable command identifier a view registers its handler
 * under, the human description surfaced by the shortcuts overlay and the Keyboard settings section,
 * and the default chord applied when the user has not overridden it.
 */
export interface CatalogueBinding {
  /**
   * Gets the stable, namespaced command identifier (for example `code.save`). Overrides persist
   * against this id, so it must never change once shipped.
   */
  readonly id: string;

  /**
   * Gets the human description of the command (for example `Save`), shown by the discoverability
   * surfaces.
   */
  readonly description: string;

  /**
   * Gets the default key chord, written with the platform-neutral `Mod` modifier.
   */
  readonly chord: string;
}

/**
 * Describes one view's contribution to the keybinding catalogue: its display label and the
 * accelerators it registers while active.
 */
export interface KeybindingCatalogueEntry {
  /**
   * Gets the label the discoverability surfaces group the bindings under (for example `Code Editor`).
   */
  readonly view: string;

  /**
   * Gets a value indicating whether every chord in this entry must include both `Mod` and `Shift`.
   * The terminal sets this: a bare `Mod` is Ctrl on Windows/Linux and collides with the shell's own
   * control codes, so overrides that drop `Shift` are rejected.
   */
  readonly modShiftOnly?: boolean;

  /**
   * Gets the accelerators the view contributes.
   */
  readonly bindings: readonly CatalogueBinding[];
}

/**
 * Names the multi-provider token features contribute their keybinding catalogues through. The shared
 * {@link import('./keybindings').Keybindings} service aggregates the contributions without naming any
 * feature, mirroring the feature-registry pattern.
 */
export const KEYBINDING_CATALOGUE: InjectionToken<readonly KeybindingCatalogueEntry[]> =
  new InjectionToken<readonly KeybindingCatalogueEntry[]>('KEYBINDING_CATALOGUE');

/**
 * Contributes one view's keybinding catalogue entry.
 * @param entry The catalogue entry the feature contributes.
 * @returns Returns the multi-provider registering the entry.
 */
export function provideKeybindingCatalogue(entry: KeybindingCatalogueEntry): Provider {
  return { provide: KEYBINDING_CATALOGUE, useValue: entry, multi: true };
}
