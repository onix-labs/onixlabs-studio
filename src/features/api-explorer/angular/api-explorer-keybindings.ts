import { KeybindingCatalogueEntry } from '@shared/angular/services/keybindings/keybinding-catalogue';

/**
 * Catalogues the API Explorer's keyboard accelerators. The feature is contributed lazily, so this
 * entry travels on its descriptor rather than through the root catalogue multi-provider.
 */
export const API_EXPLORER_KEYBINDINGS: KeybindingCatalogueEntry = {
  view: 'API Explorer',
  bindings: [
    { id: 'api.save', description: 'Save the API document', chord: 'Mod+S' },
    { id: 'api.saveAs', description: 'Save the API document as…', chord: 'Mod+Shift+S' },
  ],
};
