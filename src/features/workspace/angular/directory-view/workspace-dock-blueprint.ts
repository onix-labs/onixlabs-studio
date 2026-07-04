import { AgentPanel } from '@shared/angular/components/panels/agent-panel/agent-panel';
import { OutputPanel } from '@features/workspace/angular/panels/output-panel/output-panel';
import { ProblemsPanel } from '@features/workspace/angular/panels/problems-panel/problems-panel';
import { SolutionPanel } from '@features/workspace/angular/panels/solution-panel/solution-panel';
import { TerminalPanel } from '@shared/angular/components/panels/terminal-panel/terminal-panel';
import { TreePanel } from '@features/workspace/angular/panels/tree-panel/tree-panel';
import { Icon } from '@shared/angular/icons/icon';
import { DockBlueprint } from '@shared/angular/services/dock/dock-blueprint';
import { DockNode } from '@shared/angular/services/dock/dock-node';
import { defaultLayout } from '@shared/angular/services/dock/dock-tree';

/**
 * The blueprint specialising a dock instance as a workspace (directory / IDE) surface: the File
 * Explorer pinned full-height on the left, the agent full-height on the right, and the document well
 * in the centre with Output, the Error List, and a terminal tabbed along the bottom. The Solution
 * Explorer is catalogued but not in the starting layout — the directory view adds it only when the
 * open root has a recognised project system, and removes it otherwise. Every panel is dockable.
 *
 * This is the blueprint the workspace tab provides to the shared dock framework, mirroring the
 * source-control tab's own dock blueprint. It replaces the dock's former built-in default, so the
 * dock names no feature panel of its own.
 */
export const WORKSPACE_DOCK_BLUEPRINT: DockBlueprint = {
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
    { id: 'agent', title: 'Agent', icon: Icon.AGENT, role: 'tool', component: AgentPanel },
    { id: 'output', title: 'Output', icon: Icon.OUTPUT, role: 'tool', component: OutputPanel },
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
