import { AgentPanel } from '@shared/angular/components/panels/agent-panel/agent-panel';
import { DebugPanel } from '@features/workspace/angular/panels/debug-panel/debug-panel';
import { OutputPanel } from '@features/workspace/angular/panels/output-panel/output-panel';
import { ProblemsPanel } from '@features/workspace/angular/panels/problems-panel/problems-panel';
import { SearchPanel } from '@features/workspace/angular/panels/search-panel/search-panel';
import { SolutionPanel } from '@features/workspace/angular/panels/solution-panel/solution-panel';
import { TerminalPanel } from '@shared/angular/components/panels/terminal-panel/terminal-panel';
import { TreePanel } from '@features/workspace/angular/panels/tree-panel/tree-panel';
import { Icon } from '@shared/angular/icons/icon';
import { DockBlueprint } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockNode } from '@shared/angular/services/dock-layout/dock-node';
import { defaultLayout } from '@shared/angular/services/dock-layout/dock-tree';

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
    return defaultLayout();
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
    { id: 'output', title: 'Output', icon: Icon.OUTPUT, role: 'tool', component: OutputPanel },
    { id: 'debug', title: 'Debug', icon: Icon.DEBUG, role: 'tool', component: DebugPanel },
    {
      id: 'errors',
      title: 'Error List',
      icon: Icon.PROBLEMS,
      role: 'tool',
      component: ProblemsPanel,
    },
    {
      id: 'terminal',
      title: 'Terminal',
      icon: Icon.TERMINAL,
      role: 'tool',
      component: TerminalPanel,
    },
  ],
};
