import { KeybindingCatalogueEntry } from '@shared/angular/services/keybindings/keybinding-catalogue';

/**
 * Catalogues the workspace (directory) view's keyboard accelerators.
 */
export const WORKSPACE_KEYBINDINGS: KeybindingCatalogueEntry = {
  view: 'Workspace',
  bindings: [
    { id: 'workspace.findInFiles', description: 'Find in files', chord: 'Mod+Shift+F' },
    {
      id: 'workspace.goToSymbol',
      description: 'Go to a symbol anywhere in the workspace',
      chord: 'Mod+T',
    },
    {
      id: 'workspace.saveAll',
      description: 'Save all documents in the well',
      chord: 'Mod+S',
    },
  ],
};
