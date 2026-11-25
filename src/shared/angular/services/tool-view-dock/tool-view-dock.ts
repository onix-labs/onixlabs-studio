import type { AgentSurface } from '@shared/api/ai-types';
import { ConversationContext } from '@shared/api/agent-conversation-channels';
import { DockBlueprint } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockNode, mkSplit, mkStack } from '@shared/angular/services/dock-layout/dock-node';
import { SIMPLE_DOCK } from '@shared/angular/services/dock-layout/dock-simple';

/**
 * The identifier of the main group's panel in a tool view's dock: the view's own content.
 */
export const TOOL_VIEW_MAIN_PANEL_ID: string = 'main';

/**
 * The identifier of the agent panel in a tool view's dock.
 */
export const TOOL_VIEW_AGENT_PANEL_ID: string = 'agent';

/**
 * The identifier of the panel holding a tool view's own list, in the dock of a view that has one.
 */
export const TOOL_VIEW_LIST_PANEL_ID: string = 'list';

/**
 * Builds the blueprint specialising a dock as a tool view's (#1572): the view's content in the centre,
 * with its agent on the right, closed until it is asked for, and its list, if it has one, on the left
 * (#1575).
 * @param key The key the dock's layout is kept under.
 * @param options Whether the view has a list.
 * @returns Returns the blueprint.
 */
export function toolViewDockBlueprint(
  key: string,
  options: { readonly list?: boolean } = {},
): DockBlueprint {
  const list: readonly string[] = options.list === true ? [TOOL_VIEW_LIST_PANEL_ID] : [];
  return {
    key,
    createLayout(): DockNode {
      return mkSplit('row', [
        ...list.map((id: string): DockNode => mkStack('tool', [id])),
        mkStack('main', [TOOL_VIEW_MAIN_PANEL_ID]),
        mkStack('tool', [TOOL_VIEW_AGENT_PANEL_ID]),
      ]);
    },
    panels: [],
    templatePanels: [...list, TOOL_VIEW_MAIN_PANEL_ID, TOOL_VIEW_AGENT_PANEL_ID],
    startsOpen: list,
    ...SIMPLE_DOCK,
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
