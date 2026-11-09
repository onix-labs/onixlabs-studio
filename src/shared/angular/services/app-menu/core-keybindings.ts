import { KeybindingCatalogueEntry } from '@shared/angular/services/keybindings/keybinding-catalogue';

/**
 * Catalogues the application menu's own commands, which work whichever tab is in front, so they are
 * editable on Application › Keyboard and the menu shows whatever chord is in effect.
 *
 * The editing commands (undo, redo, cut, copy, paste) are deliberately absent: they are native roles
 * the platform routes to whatever holds focus, and no command may take their chords.
 */
export const APPLICATION_KEYBINDINGS: KeybindingCatalogueEntry = {
  view: 'Application',
  global: true,
  bindings: [
    { id: 'app.openFile', description: 'Open a file', chord: 'Mod+O' },
    { id: 'app.settings', description: 'Open Settings', chord: 'Mod+,' },
    { id: 'app.closeTab', description: 'Close the active tab', chord: 'Mod+W' },
  ],
};
