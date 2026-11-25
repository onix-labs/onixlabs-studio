import { DockBlueprint } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockNode, mkSplit, mkStack } from '@shared/angular/services/dock-layout/dock-node';
import { EDITOR_TERMINAL_PANEL_ID } from '@shared/angular/services/editor-terminals/editor-terminals';

/**
 * The identifier of the main group's panel: the editor.
 */
export const CODE_EDITOR_PANEL_ID: string = 'editor';

/**
 * The identifier of the agent panel.
 */
export const CODE_AGENT_PANEL_ID: string = 'agent';

/**
 * The identifier of the generated-code panel.
 */
export const CODE_GENERATED_PANEL_ID: string = 'generated';

/**
 * The identifier of the Find panel.
 */
export const CODE_FIND_PANEL_ID: string = 'find';

/**
 * The identifier of the References panel.
 */
export const CODE_REFERENCES_PANEL_ID: string = 'references';

/**
 * The blueprint specialising a dock as a code tab's (#1571): the editor in the centre, with the run
 * terminal beneath it and the other panels tabbed together on its right, all closed until they are asked
 * for.
 */
export const CODE_DOCK_BLUEPRINT: DockBlueprint = {
  key: 'code',
  createLayout(): DockNode {
    return mkSplit('row', [
      mkSplit('col', [
        mkStack('main', [CODE_EDITOR_PANEL_ID]),
        mkStack('tool', [EDITOR_TERMINAL_PANEL_ID]),
      ]),
      mkStack('tool', [
        CODE_AGENT_PANEL_ID,
        CODE_GENERATED_PANEL_ID,
        CODE_FIND_PANEL_ID,
        CODE_REFERENCES_PANEL_ID,
      ]),
    ]);
  },
  panels: [],
  templatePanels: [
    CODE_EDITOR_PANEL_ID,
    EDITOR_TERMINAL_PANEL_ID,
    CODE_AGENT_PANEL_ID,
    CODE_GENERATED_PANEL_ID,
    CODE_FIND_PANEL_ID,
    CODE_REFERENCES_PANEL_ID,
  ],
  startsOpen: [],
  appearance: 'simple',
  buttons: ['close'],
};
