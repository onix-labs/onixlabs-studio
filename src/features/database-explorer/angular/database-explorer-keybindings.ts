import { KeybindingCatalogueEntry } from '@shared/angular/services/keybindings/keybinding-catalogue';

/**
 * Catalogues the Database Explorer's keyboard accelerators. ⌘↵ (run the query) is the editor's own
 * command rather than a catalogued chord, so it only fires with the query's editor focused.
 */
export const DATABASE_EXPLORER_KEYBINDINGS: KeybindingCatalogueEntry = {
  view: 'Database Explorer',
  bindings: [
    { id: 'database.save', description: 'Save the database document', chord: 'Mod+S' },
    { id: 'database.saveAs', description: 'Save the database document as…', chord: 'Mod+Shift+S' },
  ],
};
