import { Icon } from '../../../icons/icon';
import { DockBlueprint } from '../../../services/dock/dock-blueprint';
import { DockNode, mkSplit, mkStack } from '../../../services/dock/dock-node';
import { CommitDetail } from './panels/commit-detail/commit-detail';
import { CommitGraph } from './panels/commit-graph/commit-graph';
import { SourceControlSidebar } from './panels/source-control-sidebar/source-control-sidebar';

/**
 * The blueprint specialising a dock instance as a source-control (repository) surface. The "Well-
 * centric" default puts the Repository rail (branches, remotes, tags, stashes) on the left, the diff
 * document well in the centre where changed files open, and the History graph over the Commit detail
 * on the right. Every panel is dockable, so the user can rearrange or float them.
 */
export const REPOSITORY_DOCK_BLUEPRINT: DockBlueprint = {
  createLayout(): DockNode {
    return mkSplit(
      'row',
      [
        mkStack('tool', ['branches']),
        mkStack('document', []),
        mkSplit('col', [mkStack('tool', ['history']), mkStack('tool', ['commit'])], [3, 2]),
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
  ],
};
