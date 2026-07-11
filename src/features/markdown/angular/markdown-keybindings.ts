import { KeybindingCatalogueEntry } from '@shared/angular/services/keybindings/keybinding-catalogue';

/**
 * Catalogues the markdown editor's keyboard accelerators. Save (`Mod+S`) is deliberately absent: the
 * Crepe pane owns it (raising `saveRequested`), so cataloguing it here would save twice; the pane's
 * formatting accelerators likewise compose underneath.
 */
export const MARKDOWN_KEYBINDINGS: KeybindingCatalogueEntry = {
  view: 'Markdown Editor',
  bindings: [
    { id: 'markdown.saveAs', description: 'Save the document as…', chord: 'Mod+Shift+S' },
    { id: 'markdown.find', description: 'Find & replace', chord: 'Mod+F' },
  ],
};
