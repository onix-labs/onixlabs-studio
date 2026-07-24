import {
  ApplicationRef,
  ComponentRef,
  createComponent,
  EnvironmentInjector,
  inject,
  Injector,
  OnDestroy,
  Service,
} from '@angular/core';
import {
  AuxiliaryWindow,
  AuxiliaryWindows,
} from '@shared/angular/services/auxiliary-windows/auxiliary-windows';
import { DockNode, StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { findNode, findStackOfPanel } from '@shared/angular/services/dock-layout/dock-tree';
import { PopoutPanels } from '@shared/angular/services/dock-layout/popout-panels';

/**
 * One popped panel's bookkeeping: its auxiliary window, the component rendered into it, and where
 * in the dock it came from.
 */
interface OpenPanel {
  /**
   * Gets the auxiliary window hosting the panel.
   */
  readonly window: AuxiliaryWindow;

  /**
   * Gets the panel component rendered into the window.
   */
  readonly component: ComponentRef<unknown>;

  /**
   * Gets the dock position the panel left, or null when it was not in the layout.
   */
  readonly origin: { readonly stackId: string; readonly index: number } | null;
}

/**
 * The generic pop-out coordinator: moves ANY dock panel into its own OS window and back. It is the
 * {@link PopoutPanels} FALLBACK — panels with a bespoke coordinator (the terminal's main-process
 * mirror) keep it; every other panel is hosted through an auxiliary window, where the panel
 * component renders into the child document with THIS view's injector. The panel therefore keeps
 * its real services — diagnostics, logs, debug state, the agent conversation — and its actions
 * (revealing a document, running a search) land in this workspace exactly as if it were docked.
 *
 * Closing the window returns the panel to the stack and tab position it left. Provided per view
 * alongside the dock services, and instantiated eagerly so the dock chrome offers pop-out from the
 * first render.
 */
@Service()
export class PanelPopout implements OnDestroy {
  /**
   * Holds the auxiliary-window opener.
   */
  private readonly aux: AuxiliaryWindows = inject(AuxiliaryWindows);

  /**
   * Holds the pop-out seam this coordinator registers with.
   */
  private readonly popouts: PopoutPanels = inject(PopoutPanels);

  /**
   * Holds the view's dock state, panels are removed from and restored to.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the reveal helper used to surface a panel after it docks back.
   */
  private readonly dockReveal: DockReveal = inject(DockReveal);

  /**
   * Holds the registry panel components are resolved through.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Holds this view's injector, so popped panels resolve the view's own service instances.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the environment injector popped components are created with.
   */
  private readonly environmentInjector: EnvironmentInjector = inject(EnvironmentInjector);

  /**
   * Holds the application, whose change detection popped views attach to.
   */
  private readonly applicationRef: ApplicationRef = inject(ApplicationRef);

  /**
   * Holds the popped panels by identifier.
   */
  private readonly open: Map<string, OpenPanel> = new Map<string, OpenPanel>();

  /**
   * Holds the fallback deregistration.
   */
  private readonly disposeFallback: () => void;

  /**
   * Initializes a new instance of the {@link PanelPopout} class, registering as the pop-out
   * fallback for every panel.
   */
  public constructor() {
    this.disposeFallback = this.popouts.registerFallback((panelId: string): void =>
      this.popOut(panelId),
    );
  }

  /**
   * Pops a panel out into its own OS window, remembering where in the dock it came from. When it is
   * already popped out, its window is focused instead.
   * @param panelId The panel identifier.
   */
  public popOut(panelId: string): void {
    const existing: OpenPanel | undefined = this.open.get(panelId);
    if (existing !== undefined) {
      existing.window.focus();
      return;
    }
    const panel: DockPanel | undefined = this.registry.get(panelId);
    if (panel === undefined) {
      return;
    }

    const stack: StackNode | null = findStackOfPanel(this.dockState.layout(), panelId);
    const origin: { stackId: string; index: number } | null =
      stack === null ? null : { stackId: stack.id, index: stack.panels.indexOf(panelId) };

    const window: AuxiliaryWindow | null = this.aux.open(panel.title);
    if (window === null) {
      return;
    }
    this.dockState.removeFromLayout(panelId);

    // The component renders into the child document but is created with THIS view's injector, so
    // it resolves the same service instances it had while docked.
    const component: ComponentRef<unknown> = createComponent(panel.component, {
      environmentInjector: this.environmentInjector,
      elementInjector: this.injector,
      hostElement: window.contentHost.appendChild(
        window.contentHost.ownerDocument.createElement('div'),
      ),
    });
    component.setInput('panel', panel);
    this.applicationRef.attachView(component.hostView);

    this.popouts.markPopped(panelId, (): void => window.focus());
    window.onClosed((): void => this.handleClosed(panelId));
    this.open.set(panelId, { window, component, origin });
  }

  /**
   * Handles a popped panel's window having closed, returning the panel to the dock.
   * @param panelId The panel identifier.
   */
  private handleClosed(panelId: string): void {
    const entry: OpenPanel | undefined = this.open.get(panelId);
    if (entry === undefined) {
      return;
    }
    this.open.delete(panelId);
    this.applicationRef.detachView(entry.component.hostView);
    entry.component.destroy();
    this.popouts.clear(panelId);
    this.restorePanel(panelId, entry.origin);
    this.dockReveal.reveal(panelId);
  }

  /**
   * Restores a panel to the dock: to the stack and tab index it left when they still exist,
   * otherwise docked to the bottom edge.
   * @param panelId The panel identifier.
   * @param origin The dock position the panel left, or null when unknown.
   */
  private restorePanel(
    panelId: string,
    origin: { readonly stackId: string; readonly index: number } | null,
  ): void {
    const tree: DockNode = this.dockState.layout();
    if (findStackOfPanel(tree, panelId) !== null) {
      return;
    }
    const originStack: DockNode | null = origin === null ? null : findNode(tree, origin.stackId);
    if (origin !== null && originStack !== null && originStack.kind === 'stack') {
      this.dockState.tabInto(origin.stackId, panelId);
      const placed: DockNode | null = findNode(this.dockState.layout(), origin.stackId);
      if (placed !== null && placed.kind === 'stack') {
        const from: number = placed.panels.indexOf(panelId);
        const to: number = Math.min(origin.index, placed.panels.length - 1);
        if (from !== -1 && from !== to) {
          this.dockState.reorderTab(origin.stackId, from, to);
        }
      }
    } else {
      this.dockState.dockEdge(panelId, 'bottom');
    }
  }

  /**
   * Closes every popped panel's window when the owning view goes away. The panels are not
   * re-docked — the view's dock is being destroyed with them.
   */
  public ngOnDestroy(): void {
    this.disposeFallback();
    for (const [panelId, entry] of this.open) {
      this.open.delete(panelId);
      this.applicationRef.detachView(entry.component.hostView);
      entry.component.destroy();
      entry.window.close();
    }
  }
}
