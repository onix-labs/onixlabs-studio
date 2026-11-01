import { KeybindingCatalogueEntry } from '@shared/angular/services/keybindings/keybinding-catalogue';

/**
 * Catalogues the Containers's keyboard accelerators. The feature is contributed lazily, so this entry
 * travels on its descriptor rather than through the root catalogue multi-provider; its menu's Refresh
 * takes its shortcut from here.
 */
export const CONTAINERS_KEYBINDINGS: KeybindingCatalogueEntry = {
  view: 'Containers',
  bindings: [
    {
      id: 'containers.refresh',
      description: 'Refresh the containers and images',
      chord: 'Mod+Shift+R',
    },
  ],
};
