import { DockBlueprint } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockNode, mkSplit, mkStack } from '@shared/angular/services/dock-layout/dock-node';

/**
 * The identifier of the main group's panel: the conversation.
 */
export const AGENT_CHAT_PANEL_ID: string = 'chat';

/**
 * The identifier of the Conversation History panel.
 */
export const AGENT_HISTORY_PANEL_ID: string = 'history';

/**
 * The blueprint specialising a dock as an agent tab's (#1571): the conversation in the centre, with its
 * history on the right, closed until it is asked for.
 */
export const AGENT_DOCK_BLUEPRINT: DockBlueprint = {
  key: 'agent',
  createLayout(): DockNode {
    return mkSplit('row', [
      mkStack('main', [AGENT_CHAT_PANEL_ID]),
      mkStack('tool', [AGENT_HISTORY_PANEL_ID]),
    ]);
  },
  panels: [],
  templatePanels: [AGENT_CHAT_PANEL_ID, AGENT_HISTORY_PANEL_ID],
  startsOpen: [],
  appearance: 'simple',
  buttons: ['close'],
};
