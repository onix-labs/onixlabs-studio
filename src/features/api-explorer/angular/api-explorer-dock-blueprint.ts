import { TerminalPanel } from '@shared/angular/components/panels/terminal-panel/terminal-panel';
import { Icon } from '@shared/angular/icons/icon';
import { DockBlueprint } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockNode, mkSplit, mkStack } from '@shared/angular/services/dock-layout/dock-node';
import { ApiAgentPanel } from './panels/api-agent-panel/api-agent-panel';
import { ApiEnvironmentPanel } from './panels/api-environment-panel/api-environment-panel';
import { ApiExplorerPanel } from './panels/api-explorer-panel/api-explorer-panel';
import { ApiHistoryPanel } from './panels/api-history-panel/api-history-panel';

/**
 * The blueprint specialising a dock instance as an API Explorer surface, deliberately arranged as the
 * workspace is so the two read as the same application: the explorer pinned full-height on the left,
 * the agent full-height on the right, and the API well in the centre with History and the environment
 * editor tabbed along the bottom.
 *
 * The well holds `document`-role panels exactly as a workspace's does — the documents just happen to be
 * requests rather than files. Nothing in the dock framework knows the difference, which is the whole
 * point of reusing it: tabbing, splitting, floating, popping out, collapsing to a gutter and layout
 * persistence all arrive for free.
 *
 * The agent panel is this feature's own rather than the shared one, because it runs on the `api`
 * surface: that is what makes the providers expose the API tools, so the agent can add an endpoint to
 * the tree and send it rather than only talk about it.
 *
 * A terminal is catalogued but kept out of the starting layout. Reaching for `curl` beside the request
 * you are building is a natural thing to want, and the panel costs nothing until it is docked.
 */
export const API_EXPLORER_DOCK_BLUEPRINT: DockBlueprint = {
  key: 'api-explorer',
  createLayout(): DockNode {
    return mkSplit(
      'row',
      [
        mkStack('tool', ['apis']),
        mkSplit(
          'col',
          [mkStack('document', [], true), mkStack('tool', ['history', 'environment'])],
          [3.4, 1.6],
        ),
        mkStack('tool', ['agent']),
      ],
      [1.4, 4, 1.6],
    );
  },
  panels: [
    {
      id: 'apis',
      title: 'API Explorer',
      icon: Icon.API_EXPLORER,
      role: 'tool',
      component: ApiExplorerPanel,
      ownsToolStrip: true,
    },
    {
      id: 'history',
      title: 'History',
      icon: Icon.API_HISTORY,
      role: 'tool',
      component: ApiHistoryPanel,
      ownsToolStrip: true,
    },
    {
      id: 'environment',
      title: 'Environment',
      icon: Icon.API_ENVIRONMENT,
      role: 'tool',
      component: ApiEnvironmentPanel,
      ownsToolStrip: true,
    },
    {
      id: 'agent',
      title: 'Agent',
      icon: Icon.AGENT,
      role: 'tool',
      component: ApiAgentPanel,
      ownsToolStrip: true,
    },
    {
      id: 'terminal',
      title: 'Terminal',
      icon: Icon.TERMINAL,
      role: 'tool',
      component: TerminalPanel,
      ownsToolStrip: true,
    },
  ],
};
