import { DockBlueprint } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockNode, mkSplit, mkStack } from '@shared/angular/services/dock-layout/dock-node';
import { SIMPLE_DOCK } from '@shared/angular/services/dock-layout/dock-simple';

/**
 * The identifier of the main group's panel: the bytes.
 */
export const BINARY_EDITOR_PANEL_ID: string = 'editor';

/**
 * The identifier of the disassembly panel.
 */
export const BINARY_DISASSEMBLY_PANEL_ID: string = 'disassembly';

/**
 * The identifier of the data inspector's panel.
 */
export const BINARY_INSPECTOR_PANEL_ID: string = 'inspector';

/**
 * The identifier of the agent panel.
 */
export const BINARY_AGENT_PANEL_ID: string = 'agent';

/**
 * The identifier of the Find panel.
 */
export const BINARY_FIND_PANEL_ID: string = 'find';

/**
 * The blueprint specialising a dock as a binary tab's (#1571): the bytes in the centre, with the panels
 * tabbed together on their right, all closed until they are asked for.
 */
export const BINARY_DOCK_BLUEPRINT: DockBlueprint = {
  key: 'binary',
  createLayout(): DockNode {
    return mkSplit('row', [
      mkStack('main', [BINARY_EDITOR_PANEL_ID]),
      mkStack('tool', [
        BINARY_DISASSEMBLY_PANEL_ID,
        BINARY_INSPECTOR_PANEL_ID,
        BINARY_AGENT_PANEL_ID,
        BINARY_FIND_PANEL_ID,
      ]),
    ]);
  },
  panels: [],
  templatePanels: [
    BINARY_EDITOR_PANEL_ID,
    BINARY_DISASSEMBLY_PANEL_ID,
    BINARY_INSPECTOR_PANEL_ID,
    BINARY_AGENT_PANEL_ID,
    BINARY_FIND_PANEL_ID,
  ],
  startsOpen: [],
  ...SIMPLE_DOCK,
};
