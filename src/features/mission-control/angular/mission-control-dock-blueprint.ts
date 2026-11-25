import { DockBlueprint } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockNode, mkSplit, mkStack } from '@shared/angular/services/dock-layout/dock-node';

/**
 * The identifier of the main group's panel: the agents' columns.
 */
export const MISSION_CONTROL_COLUMNS_PANEL_ID: string = 'columns';

/**
 * The identifier of the panel listing the agents.
 */
export const MISSION_CONTROL_AGENTS_PANEL_ID: string = 'agents';

/**
 * The blueprint specialising a dock as Mission Control's (#1572): the agents' columns in the centre, with
 * their list on the left. The list is always open, so its title bar shows no buttons.
 */
export const MISSION_CONTROL_DOCK_BLUEPRINT: DockBlueprint = {
  key: 'mission-control',
  createLayout(): DockNode {
    return mkSplit('row', [
      mkStack('tool', [MISSION_CONTROL_AGENTS_PANEL_ID]),
      mkStack('main', [MISSION_CONTROL_COLUMNS_PANEL_ID]),
    ]);
  },
  panels: [],
  templatePanels: [MISSION_CONTROL_AGENTS_PANEL_ID, MISSION_CONTROL_COLUMNS_PANEL_ID],
  startsOpen: [MISSION_CONTROL_AGENTS_PANEL_ID],
  appearance: 'simple',
  buttons: [],
};
