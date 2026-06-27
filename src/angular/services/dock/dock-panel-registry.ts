import { inject, Service, Type } from '@angular/core';
import { AgentPanel } from '../../components/panels/agent-panel/agent-panel';
import { OutputPanel } from '../../components/panels/output-panel/output-panel';
import { ProblemsPanel } from '../../components/panels/problems-panel/problems-panel';
import { SolutionPanel } from '../../components/panels/solution-panel/solution-panel';
import { TerminalPanel } from '../../components/panels/terminal-panel/terminal-panel';
import { TreePanel } from '../../components/panels/tree-panel/tree-panel';
import { Icon } from '../../icons/icon';
import { DOCK_BLUEPRINT, DockBlueprint } from './dock-blueprint';
import { DockPanel } from './dock-panel';

/**
 * Maps panel identifiers to the dockable panels they render, so stacks in the layout tree (which
 * hold only ids) can be projected as titled, iconified panels with real component bodies.
 */
@Service()
export class DockPanelRegistry {
  /**
   * Holds the registered panels, keyed by identifier.
   */
  private readonly panels: Map<string, DockPanel> = new Map<string, DockPanel>();

  /**
   * Initialises the registry from the host-supplied blueprint's panels, or the built-in workspace
   * catalogue when no blueprint was provided.
   */
  public constructor() {
    const blueprint: DockBlueprint | null = inject(DOCK_BLUEPRINT, { optional: true });
    if (blueprint !== null) {
      for (const panel of blueprint.panels) {
        this.register(panel);
      }
    } else {
      this.seed();
    }
  }

  /**
   * Registers a panel, replacing any existing registration with the same identifier.
   * @param panel The panel to register.
   */
  public register(panel: DockPanel): void {
    this.panels.set(panel.id, panel);
  }

  /**
   * Gets the panel with the given identifier.
   * @param id The identifier of the panel to resolve.
   * @returns Returns the registered panel, or undefined when none is registered.
   */
  public get(id: string): DockPanel | undefined {
    return this.panels.get(id);
  }

  /**
   * Determines whether a panel with the given identifier is registered.
   * @param id The identifier to test.
   * @returns Returns true when a panel is registered; otherwise, false.
   */
  public has(id: string): boolean {
    return this.panels.has(id);
  }

  /**
   * Seeds the catalogue of built-in IDE tool panels. Documents are registered dynamically as files
   * open into the well.
   */
  private seed(): void {
    const tool: (id: string, title: string, icon: Icon, component: Type<unknown>) => void = (
      id: string,
      title: string,
      icon: Icon,
      component: Type<unknown>,
    ): void => this.register({ id, title, icon, role: 'tool', component });

    tool('files', 'File Explorer', Icon.FILE_EXPLORER, TreePanel);
    // The Solution Explorer is catalogued but not in the seeded layout: the directory view adds it to
    // the layout only when the open root has a recognised project system, and removes it otherwise.
    tool('solution', 'Solution Explorer', Icon.SOLUTION_EXPLORER, SolutionPanel);
    tool('agent', 'Agent', Icon.AGENT, AgentPanel);
    tool('output', 'Output', Icon.OUTPUT, OutputPanel);
    tool('errors', 'Error List', Icon.PROBLEMS, ProblemsPanel);
    tool('terminal', 'Terminal', Icon.TERMINAL, TerminalPanel);
  }
}
