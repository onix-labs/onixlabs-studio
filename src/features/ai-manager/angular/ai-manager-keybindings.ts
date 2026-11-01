import { KeybindingCatalogueEntry } from '@shared/angular/services/keybindings/keybinding-catalogue';

/**
 * Catalogues the AI Manager's keyboard accelerators. The feature is contributed lazily, so this entry
 * travels on its descriptor rather than through the root catalogue multi-provider; its menu's Refresh
 * takes its shortcut from here.
 */
export const AI_MANAGER_KEYBINDINGS: KeybindingCatalogueEntry = {
  view: 'AI Manager',
  bindings: [
    { id: 'models.refresh', description: 'Refresh the models and runtime', chord: 'Mod+Shift+R' },
  ],
};
