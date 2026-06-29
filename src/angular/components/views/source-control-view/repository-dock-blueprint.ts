import { AgentPanel } from '../../panels/agent-panel/agent-panel';
import { TerminalPanel } from '../../panels/terminal-panel/terminal-panel';
import { Icon } from '@shared/angular/icons/icon';
import { DockBlueprint } from '../../../services/dock/dock-blueprint';
import { DockNode, mkSplit, mkStack } from '../../../services/dock/dock-node';
import { CommitDetail } from './panels/commit-detail/commit-detail';
import { CommitGraph } from './panels/commit-graph/commit-graph';
import { SourceControlSidebar } from './panels/source-control-sidebar/source-control-sidebar';

/**
 * The blueprint specialising a dock instance as a source-control (repository) surface. The Repository
 * rail (branches, remotes, tags, stashes) sits on the far left; the centre column holds the diff
 * document well on top with the History graph and a terminal tabbed together beneath it; the right
 * column tabs the Commit detail together with an agent conversation. Every panel is dockable, so the
 * user can rearrange or float them.
 */
export const REPOSITORY_DOCK_BLUEPRINT: DockBlueprint = {
  createLayout(): DockNode {
    return mkSplit(
      'row',
      [
        mkStack('tool', ['branches']),
        mkSplit('col', [mkStack('document', []), mkStack('tool', ['history', 'terminal'])], [3, 2]),
        mkStack('tool', ['commit', 'agent']),
      ],
      [1.2, 3.4, 1.6],
    );
  },
  panels: [
    {
      id: 'branches',
      title: 'Repository',
      icon: Icon.SOURCE_CONTROL,
      role: 'tool',
      component: SourceControlSidebar,
    },
    {
      id: 'history',
      title: 'History',
      icon: Icon.GIT_COMMIT,
      role: 'tool',
      component: CommitGraph,
    },
    { id: 'commit', title: 'Commit', icon: Icon.LIST_ALL, role: 'tool', component: CommitDetail },
    { id: 'agent', title: 'Agent', icon: Icon.AGENT, role: 'tool', component: AgentPanel },
    { id: 'terminal', title: 'Terminal', icon: Icon.TERMINAL, role: 'tool', component: TerminalPanel },
  ],
};
