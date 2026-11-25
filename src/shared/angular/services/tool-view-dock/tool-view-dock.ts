import type { AgentSurface } from '@shared/api/ai-types';
import { ConversationContext } from '@shared/api/agent-conversation-channels';
import { DockBlueprint } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockNode, mkSplit, mkStack } from '@shared/angular/services/dock-layout/dock-node';

/**
 * The identifier of the main group's panel in a tool view's dock: the view's own content.
 */
export const TOOL_VIEW_MAIN_PANEL_ID: string = 'main';

/**
 * The identifier of the agent panel in a tool view's dock.
 */
export const TOOL_VIEW_AGENT_PANEL_ID: string = 'agent';

/**
 * Builds the blueprint specialising a dock as a tool view's (#1572): the view's content in the centre,
 * with its agent on the right, closed until it is asked for.
 * @param key The key the dock's layout is kept under.
 * @returns Returns the blueprint.
 */
export function toolViewDockBlueprint(key: string): DockBlueprint {
  return {
    key,
    createLayout(): DockNode {
      return mkSplit('row', [
        mkStack('main', [TOOL_VIEW_MAIN_PANEL_ID]),
        mkStack('tool', [TOOL_VIEW_AGENT_PANEL_ID]),
      ]);
    },
    panels: [],
    templatePanels: [TOOL_VIEW_MAIN_PANEL_ID, TOOL_VIEW_AGENT_PANEL_ID],
    startsOpen: [],
    appearance: 'simple',
    buttons: ['close'],
  };
}

/**
 * Builds the context a tool view's conversations are filed under (#964): the tool view, keyed by its
 * agent surface, so each view's history is its own.
 * @param surface The view's agent surface.
 * @returns Returns the context.
 */
export function toolViewConversationContext(surface: AgentSurface): ConversationContext {
  return { kind: 'tool', key: surface };
}
