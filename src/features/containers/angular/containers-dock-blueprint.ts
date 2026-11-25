import { DockBlueprint } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockNode, mkSplit, mkStack } from '@shared/angular/services/dock-layout/dock-node';
import {
  TOOL_VIEW_AGENT_PANEL_ID,
  TOOL_VIEW_MAIN_PANEL_ID,
  toolViewDockBlueprint,
} from '@shared/angular/services/tool-view-dock/tool-view-dock';

/**
 * The identifier of the panel holding the logs and shells opened from container rows.
 */
export const CONTAINERS_OUTPUT_PANEL_ID: string = 'output';

/**
 * The blueprint specialising a dock as the Containers view's (#1572): its list in the centre, the output
 * beneath it and its agent on the right, both closed until they are asked for.
 */
export const CONTAINERS_DOCK_BLUEPRINT: DockBlueprint = {
  ...toolViewDockBlueprint('containers'),
  createLayout(): DockNode {
    return mkSplit('row', [
      mkSplit('col', [
        mkStack('main', [TOOL_VIEW_MAIN_PANEL_ID]),
        mkStack('tool', [CONTAINERS_OUTPUT_PANEL_ID]),
      ]),
      mkStack('tool', [TOOL_VIEW_AGENT_PANEL_ID]),
    ]);
  },
  templatePanels: [TOOL_VIEW_MAIN_PANEL_ID, CONTAINERS_OUTPUT_PANEL_ID, TOOL_VIEW_AGENT_PANEL_ID],
};
