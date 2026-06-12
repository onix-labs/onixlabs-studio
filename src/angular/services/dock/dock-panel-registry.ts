import { Service } from '@angular/core';
import { DockPanelPlaceholder } from '../../components/dock/dock-panel-placeholder/dock-panel-placeholder';
import { TreePanel } from '../../components/panels/tree-panel/tree-panel';
import { DockPanel } from './dock-panel';
import { StackRole } from './dock-node';

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
   * Initialises the registry with the seeded placeholder catalogue.
   */
  public constructor() {
    this.seed();
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
   * Seeds the placeholder panel catalogue mirrored from the dock prototype. Each entry projects the
   * shared {@link DockPanelPlaceholder} until the real IDE panels replace it.
   */
  private seed(): void {
    const tool: (id: string, title: string, icon: string) => void = (
      id: string,
      title: string,
      icon: string,
    ): void => this.add(id, title, icon, 'tool');
    const document: (id: string, title: string, icon: string) => void = (
      id: string,
      title: string,
      icon: string,
    ): void => this.add(id, title, icon, 'document');

    this.register({
      id: 'solution',
      title: 'Solution Explorer',
      icon: 'ti ti-sitemap',
      role: 'tool',
      component: TreePanel,
    });
    tool('toolbox', 'Toolbox', 'ti ti-tools');
    tool('props', 'Properties', 'ti ti-adjustments');
    tool('output', 'Output', 'ti ti-terminal');
    tool('errors', 'Error List', 'ti ti-alert-triangle');
    document('doc1', 'Program.cs', 'ti ti-file-code');
    document('doc2', 'Startup.cs', 'ti ti-file-code');
    document('doc3', 'readme.md', 'ti ti-markdown');
  }

  /**
   * Registers a placeholder-backed panel.
   * @param id The identifier of the panel.
   * @param title The display title of the panel.
   * @param icon The icon CSS class of the panel.
   * @param role The role the panel docks as.
   */
  private add(id: string, title: string, icon: string, role: StackRole): void {
    this.register({ id, title, icon, role, component: DockPanelPlaceholder });
  }
}
