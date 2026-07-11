import { KeybindingCatalogueEntry } from '@shared/angular/services/keybindings/keybinding-catalogue';

/**
 * Catalogues the code editor's keyboard accelerators: the stable command ids the view registers its
 * handlers under, their descriptions for the discoverability surfaces, and their default chords.
 * Only commands the Monaco pane does not already bind are catalogued — the editor's own accelerators
 * (find, undo, redo, clipboard) compose underneath.
 */
export const CODE_KEYBINDINGS: KeybindingCatalogueEntry = {
  view: 'Code Editor',
  bindings: [
    { id: 'code.save', description: 'Save the active document', chord: 'Mod+S' },
    { id: 'code.saveAs', description: 'Save the active document as…', chord: 'Mod+Shift+S' },
    { id: 'code.run', description: 'Run the active document', chord: 'Mod+R' },
  ],
};
