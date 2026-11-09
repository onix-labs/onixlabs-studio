import { KeybindingCatalogueEntry } from '@shared/angular/services/keybindings/keybinding-catalogue';

/**
 * Catalogues the System Monitor's keyboard accelerators. The feature is contributed lazily, so this entry
 * travels on its descriptor rather than through the root catalogue multi-provider; its menu's Refresh
 * takes its shortcut from here.
 */
export const SYSTEM_MONITOR_KEYBINDINGS: KeybindingCatalogueEntry = {
  view: 'System Monitor',
  bindings: [
    { id: 'monitor.refresh', description: 'Refresh the metrics and logs', chord: 'Mod+Shift+R' },
  ],
};
