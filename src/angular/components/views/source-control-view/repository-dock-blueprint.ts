import { Icon } from '../../../icons/icon';
import { DockBlueprint } from '../../../services/dock/dock-blueprint';
import { DockNode, mkSplit, mkStack } from '../../../services/dock/dock-node';
import { CommitDetail } from './panels/commit-detail/commit-detail';
import { CommitGraph } from './panels/commit-graph/commit-graph';
import { SourceControlSidebar } from './panels/source-control-sidebar/source-control-sidebar';

/**
 * The blueprint specialising a dock instance as a source-control (repository) surface. The default
 * puts the Repository rail (branches, remotes, tags, stashes) on the far left and the Commit detail
 * on the far right, with the centre column split between the diff document well on top (where changed
 * files open) and the History graph below it. Every panel is dockable, so the user can rearrange or
 * float them.
 */
export const REPOSITORY_DOCK_BLUEPRINT: DockBlueprint = {
  createLayout(): DockNode {
    return mkSplit(
      'row',
      [
        mkStack('tool', ['branches']),
        mkSplit('col', [mkStack('document', []), mkStack('tool', ['history'])], [3, 2]),
        mkStack('tool', ['commit']),
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
