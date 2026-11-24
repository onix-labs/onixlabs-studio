import { DockBlueprint } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockNode, mkSplit, mkStack } from '@shared/angular/services/dock-layout/dock-node';

/**
 * The identifier of the main group's panel: the terminal itself.
 */
export const TERMINAL_PANEL_ID: string = 'terminal';

/**
 * The identifier of the agent panel.
 */
export const TERMINAL_AGENT_PANEL_ID: string = 'agent';

/**
 * The identifier of the Find panel.
 */
export const TERMINAL_FIND_PANEL_ID: string = 'find';

/**
 * The blueprint specialising a dock as a terminal tab's (#1570): the terminal in the centre, with the
 * agent and Find tabbed together on its right, both closed until they are asked for. The panels are
 * written in the view's own template.
 */
export const TERMINAL_DOCK_BLUEPRINT: DockBlueprint = {
  key: 'terminal',
  createLayout(): DockNode {
    return mkSplit('row', [
      mkStack('main', [TERMINAL_PANEL_ID]),
      mkStack('tool', [TERMINAL_AGENT_PANEL_ID, TERMINAL_FIND_PANEL_ID]),
    ]);
  },
  panels: [],
  templatePanels: [TERMINAL_PANEL_ID, TERMINAL_AGENT_PANEL_ID, TERMINAL_FIND_PANEL_ID],
  startsOpen: [],
  appearance: 'simple',
  buttons: ['close'],
};
