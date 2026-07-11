import { KeybindingCatalogueEntry } from '@shared/angular/services/keybindings/keybinding-catalogue';

/**
 * Catalogues the terminal's keyboard accelerators. The entry is marked `modShiftOnly`: a bare `Mod`
 * is Ctrl on Windows and Linux and collides with the shell's own control codes, whereas `Mod+Shift`
 * chords are never sent to the pty — so user overrides that drop Shift are rejected.
 */
export const TERMINAL_KEYBINDINGS: KeybindingCatalogueEntry = {
  view: 'Terminal',
  modShiftOnly: true,
  bindings: [{ id: 'terminal.clear', description: 'Clear the terminal', chord: 'Mod+Shift+K' }],
};
