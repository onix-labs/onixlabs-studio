import { DockBlueprint } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockNode, mkSplit, mkStack } from '@shared/angular/services/dock-layout/dock-node';
import { OPENABLE_MARKDOWN_PANELS } from './markdown-panels/markdown-panels';

/**
 * The identifier of the main group's panel: the document.
 */
export const MARKDOWN_DOCUMENT_PANEL_ID: string = 'document';

/**
 * The blueprint specialising a dock as a markdown tab's (#1571): the document in the centre, with the
 * panels tabbed together on its right, all closed until they are asked for.
 */
export const MARKDOWN_DOCK_BLUEPRINT: DockBlueprint = {
  key: 'markdown',
  createLayout(): DockNode {
    return mkSplit('row', [
      mkStack('main', [MARKDOWN_DOCUMENT_PANEL_ID]),
      mkStack('tool', [...OPENABLE_MARKDOWN_PANELS]),
    ]);
  },
  panels: [],
  templatePanels: [MARKDOWN_DOCUMENT_PANEL_ID, ...OPENABLE_MARKDOWN_PANELS],
  startsOpen: [],
  appearance: 'simple',
  buttons: ['close'],
};
