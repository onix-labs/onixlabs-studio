import { KeybindingCatalogueEntry } from '@shared/angular/services/keybindings/keybinding-catalogue';

/**
 * Catalogues the Database Explorer's keyboard accelerators. Execute (⌘↵) is matched by the query
 * editor itself, ahead of Monaco's own ⌘↵ (insert a line below), so it fires with the query's editor
 * focused.
 */
export const DATABASE_EXPLORER_KEYBINDINGS: KeybindingCatalogueEntry = {
  view: 'Database Explorer',
  bindings: [
    { id: 'database.save', description: 'Save the database document', chord: 'Mod+S' },
    { id: 'database.saveAs', description: 'Save the database document as…', chord: 'Mod+Shift+S' },
    { id: 'database.execute', description: 'Execute the query', chord: 'Mod+Enter' },
  ],
};
