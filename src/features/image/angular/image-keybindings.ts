import { KeybindingCatalogueEntry } from '@shared/angular/services/keybindings/keybinding-catalogue';

/**
 * Catalogues the image viewer's keyboard accelerators.
 *
 * Zoom in is `Mod+=` — the key `+` shares, unshifted — because a chord cannot name `+` itself (it is
 * the chord separator). The viewer also accepts the shifted `+` so either reading of "⌘+" works.
 * Undo and redo are deliberately absent: ⌘Z belongs to the core's native Edit roles (see the menu
 * editing-chords guard), so the viewer's history is reached from its ribbon and toolbar.
 */
export const IMAGE_KEYBINDINGS: KeybindingCatalogueEntry = {
  view: 'Image Viewer',
  bindings: [
    { id: 'image.zoomIn', description: 'Zoom in', chord: 'Mod+=' },
    { id: 'image.zoomOut', description: 'Zoom out', chord: 'Mod+-' },
    { id: 'image.actualSize', description: 'Actual size (1:1)', chord: 'Mod+0' },
    { id: 'image.fit', description: 'Fit to window', chord: 'Mod+9' },
    { id: 'image.save', description: 'Save the image', chord: 'Mod+S' },
    { id: 'image.exportAs', description: 'Export the image as…', chord: 'Mod+Shift+S' },
  ],
};
