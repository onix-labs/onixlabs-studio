import { AgentPanel } from '@shared/angular/components/panels/agent-panel/agent-panel';
import { DebugPanel } from '@features/workspace/angular/panels/debug-panel/debug-panel';
import { OutputPanel } from '@features/workspace/angular/panels/output-panel/output-panel';
import { PackagesPanel } from '@features/workspace/angular/panels/packages-panel/packages-panel';
import { ProblemsPanel } from '@features/workspace/angular/panels/problems-panel/problems-panel';
import { SearchPanel } from '@features/workspace/angular/panels/search-panel/search-panel';
import { SolutionPanel } from '@features/workspace/angular/panels/solution-panel/solution-panel';
import { TerminalPanel } from '@shared/angular/components/panels/terminal-panel/terminal-panel';
import { TreePanel } from '@features/workspace/angular/panels/tree-panel/tree-panel';
import { WorktreesPanel } from '@features/workspace/angular/panels/worktrees-panel/worktrees-panel';
import { Icon } from '@shared/angular/icons/icon';
import { DockBlueprint } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockNode, mkSplit, mkStack } from '@shared/angular/services/dock-layout/dock-node';

/**
 * The blueprint specialising a dock instance as a workspace (directory / IDE) surface: the File
 * Explorer pinned full-height on the left, the agent full-height on the right, and the document well
 * in the centre with Output, the Error List, and a terminal tabbed along the bottom. The Solution
 * Explorer is catalogued but not in the starting layout — the directory view adds it only when the
 * open root has a recognised project system, and removes it otherwise. Search is likewise catalogued
 * but not in the starting layout — the directory view reveals it on the find accelerator. The Debug
 * panel (call stack / variables / watch) is likewise catalogued but revealed only while a debug session
 * is running, tabbed beside Output. Every panel is dockable.
 *
 * This is the blueprint the workspace tab provides to the shared dock framework, mirroring the
 * source-control tab's own dock blueprint. It replaces the dock's former built-in default, so the
 * dock names no feature panel of its own.
 */
export const WORKSPACE_DOCK_BLUEPRINT: DockBlueprint = {
  key: 'workspace',
  createLayout(): DockNode {
    // The file explorer pinned full-height on the left, the agent full-height on the right, and the
    // document well in the centre with the Error List and a terminal tabbed along the bottom. Logs is
    // catalogued but not in the starting layout — the directory view adds it (in the background) once
    // something actually logs, and brings it forward when a debug session starts.
    return mkSplit(
      'row',
      [
        mkStack('tool', ['files']),
        mkSplit(
          'col',
          [mkStack('document', [], true), mkStack('tool', ['errors', 'terminal'])],
          [4, 1.5],
        ),
        mkStack('tool', ['agent']),
      ],
      [1.4, 4, 1.6],
    );
  },
  panels: [
    {
      id: 'files',
      title: 'File Explorer',
      icon: Icon.FILE_EXPLORER,
      role: 'tool',
      component: TreePanel,
      ownsToolStrip: true,
    },
    {
      id: 'solution',
      title: 'Solution Explorer',
      icon: Icon.SOLUTION_EXPLORER,
      role: 'tool',
      component: SolutionPanel,
      ownsToolStrip: true,
    },
    {
      id: 'search',
      title: 'Search',
      icon: Icon.SEARCH,
      role: 'tool',
      component: SearchPanel,
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
      // The demoted Output panel: a background home for LSP-server and debug-session logs, out of the
      // default layout (builds and runs live in terminal sessions). The id stays 'output' so persisted
      // layouts keep working; only its face says Logs.
      id: 'output',
      title: 'Logs',
      icon: Icon.OUTPUT,
      role: 'tool',
      component: OutputPanel,
      ownsToolStrip: true,
    },
    { id: 'debug', title: 'Debug', icon: Icon.DEBUG, role: 'tool', component: DebugPanel },
    {
      // The Package Management panel: dependencies and their upgrade state. Catalogued for every
      // workspace tab but added to the layout only when the open root has a recognised package
      // ecosystem (the directory view syncs it), in the bottom tool group alongside the Error List,
      // Terminal, and Logs.
      id: 'packages',
      title: 'Packages',
      icon: Icon.PACKAGES,
      role: 'tool',
      component: PackagesPanel,
      ownsToolStrip: true,
    },
    {
      // The container overview and switcher. Catalogued for every workspace tab but added to the
      // layout only while the tab hosts a worktree container (the directory view syncs it).
      id: 'worktrees',
      title: 'Worktrees',
      icon: Icon.WORKTREE,
      role: 'tool',
      component: WorktreesPanel,
    },
    {
      id: 'errors',
      title: 'Error List',
      icon: Icon.PROBLEMS,
      role: 'tool',
      component: ProblemsPanel,
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
