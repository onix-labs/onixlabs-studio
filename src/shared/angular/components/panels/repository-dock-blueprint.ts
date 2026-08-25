import { AgentPanel } from '@shared/angular/components/panels/agent-panel/agent-panel';
import { TerminalPanel } from '@shared/angular/components/panels/terminal-panel/terminal-panel';
import { Icon } from '@shared/angular/icons/icon';
import { DockBlueprint } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockNode, mkSplit, mkStack } from '@shared/angular/services/dock-layout/dock-node';
import { CommitDetail } from '@shared/angular/components/panels/commit-detail/commit-detail';
import { CommitGraph } from './commit-graph/commit-graph';
import { SourceControlSidebar } from './source-control-sidebar/source-control-sidebar';

/**
 * The blueprint specialising a dock instance as a source-control (repository) surface.
 *
 * Repository and Commit share the left column as tabs — the two halves of deciding what to commit,
 * one at a time. History and Terminal share the centre the same way, the graph in front. An agent
 * conversation holds the right column.
 *
 * There is deliberately no document well in the layout. History is what this surface is for, and a
 * well standing empty above it would be a permanent gap waiting for a diff that may never be opened.
 * {@link import('@shared/angular/services/diffs/diff-opener').DiffOpener} makes one beside the centre
 * the first time a diff is opened, so the space is spent only once it is earned.
 *
 * Every panel is dockable, so the user can rearrange or float them.
 */
export const REPOSITORY_DOCK_BLUEPRINT: DockBlueprint = {
  createLayout(): DockNode {
    return mkSplit(
      'row',
      [
        mkStack('tool', ['branches', 'commit']),
        // History and Terminal share the centre as tabs, History in front. Both want the whole of it
        // — a graph is read across its width and a terminal is read down its length — and neither is
        // wanted at the same moment as the other: what the terminal is for here is the command the
        // history just made you want to run.
        mkStack('tool', ['history', 'terminal'], true),
        mkStack('tool', ['agent']),
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
      ownsToolStrip: true,
    },
    {
      id: 'history',
      title: 'History',
      icon: Icon.GIT_COMMIT,
      role: 'tool',
      component: CommitGraph,
    },
    {
      id: 'commit',
      title: 'Commit',
      icon: Icon.LIST_ALL,
      role: 'tool',
      component: CommitDetail,
      ownsToolStrip: true,
    },
    {
      id: 'agent',
      title: 'Agent',
      icon: Icon.AGENT,
      role: 'tool',
      component: AgentPanel,
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
