import {
  ApplicationRef,
  ComponentRef,
  createComponent,
  effect,
  EffectRef,
  EnvironmentInjector,
  inject,
  Injector,
  OnDestroy,
  Service,
  untracked,
} from '@angular/core';
import {
  AuxiliaryWindow,
  AuxiliaryWindows,
  AuxiliaryWindowPosition,
} from '@shared/angular/services/auxiliary-windows/auxiliary-windows';
import {
  POPOUT_DOCK_CONFIG,
  PopoutDockHost,
} from '@shared/angular/components/popout-dock-host/popout-dock-host';
import { DockDrag } from '@shared/angular/services/dock-layout/dock-drag';
import { DockFloating } from '@shared/angular/services/dock-layout/dock-floating';
import { DockNode, StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { DockTabContext } from '@shared/angular/services/dock-layout/dock-tab-context';
import {
  collectPanelIds,
  findNode,
  findStackOfPanel,
  firstStackOfRole,
} from '@shared/angular/services/dock-layout/dock-tree';
import { PopoutPanels } from '@shared/angular/services/dock-layout/popout-panels';

/**
 * The dock position a panel left in the MAIN window, so docking back restores it: the stack it was
 * in and its tab index there. Null when the panel was not in the layout when popped.
 */
type PanelOrigin = { readonly stackId: string; readonly index: number } | null;

/**
 * One pop-out window's bookkeeping: the auxiliary window, the dock hosted inside it, and the panels
 * currently living there.
 */
interface PopoutWindow {
  /**
   * Gets the auxiliary window hosting the dock.
   */
  readonly window: AuxiliaryWindow;

  /**
   * Gets the auxiliary window's document, drops from its dock are measured against.
   */
  readonly document: Document;

  /**
   * Gets the dock host component rendered into the window.
   */
  readonly host: ComponentRef<PopoutDockHost>;

  /**
   * Gets the window dock's layout state.
   */
  readonly state: DockState;

  /**
   * Gets the window dock's floating layer.
   */
  readonly floating: DockFloating;

  /**
   * Gets the window dock's reveal helper.
   */
  readonly reveal: DockReveal;

  /**
   * Gets the watcher reconciling the window's panel membership (a panel closed inside the window
   * leaves the popped set; an emptied window closes).
   */
  watcher: EffectRef | null;

  /**
   * Gets the identifiers of the panels this window currently owns.
   */
  tracked: ReadonlySet<string>;
}

/**
 * The offset, in pixels, from the tear-out drop point to the new window's top-left, so the window
 * materialises with its title bar under the cursor rather than exactly at it.
 */
const TEAR_OFFSET: { readonly x: number; readonly y: number } = { x: 60, y: 20 };

/**
 * The pop-out coordinator: moves ANY dock panel into its own OS window and back. It registers as
 * the {@link PopoutPanels} handler; a popped panel is hosted through an auxiliary window titled
 * after the workspace, where a REAL dock container ({@link PopoutDockHost}) renders into the child
 * document with this view's injector as its parent. The panel therefore keeps its real services —
 * diagnostics, logs, debug state, the terminal sessions, the agent conversation — and the window
 * offers the same dock experience as the main one: panels tab together, split, float, and collapse
 * with the shared machinery.
 *
 * Windows and the dock cooperate on gestures: a tool tab dragged beyond the main window's edge
 * tears out into a new window at the drop point; one dropped onto an open pop-out window joins its
 * dock; one dragged out of a pop-out window returns to the main dock (over the main window),
 * moves to another pop-out (over one), or tears out into a new window (over neither). Closing a
 * window returns every panel it hosts to the main-dock position it left; closing a panel inside a
 * window closes it exactly as the main dock would. Provided per view alongside the dock services,
 * and instantiated eagerly so the dock chrome offers pop-out from the first render.
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
   * Holds the main dock's drag, whose outside drops this coordinator takes.
   */
  private readonly dockDrag: DockDrag = inject(DockDrag);

  /**
   * Holds the main dock's layout state, panels are removed from and restored to.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the main dock's reveal helper, used to surface a panel after it docks back.
   */
  private readonly dockReveal: DockReveal = inject(DockReveal);

  /**
   * Holds the registry panel descriptors are resolved through.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Holds the owning tab's context, whose root names the pop-out windows.
   */
  private readonly context: DockTabContext = inject(DockTabContext);

  /**
   * Holds this view's injector, the parent of every pop-out dock's injector, so popped panels
   * resolve the view's own service instances.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the environment injector popped dock hosts are created with.
   */
  private readonly environmentInjector: EnvironmentInjector = inject(EnvironmentInjector);

  /**
   * Holds the application, whose change detection popped views attach to.
   */
  private readonly applicationRef: ApplicationRef = inject(ApplicationRef);

  /**
   * Holds the open pop-out windows, oldest first.
   */
  private readonly windows: PopoutWindow[] = [];

  /**
   * Holds each popped panel's main-dock origin, keyed by panel identifier, surviving moves between
   * windows so the panel always returns to where it originally left.
   */
  private readonly origins: Map<string, PanelOrigin> = new Map<string, PanelOrigin>();

  /**
   * Holds the registration disposers.
   */
  private readonly unregister: (() => void)[] = [];

  /**
   * Holds a value indicating whether the owning view is being destroyed, so window-closed
   * notifications arriving during teardown no longer touch the dying dock.
   */
  private destroyed: boolean = false;

  /**
   * Initializes a new instance of the {@link PanelPopout} class, registering as the pop-out
   * handler for every panel and as the main dock drag's outside-drop handler.
   */
  public constructor() {
    this.unregister.push(
      this.popouts.register((panelId: string): void => this.popOut(panelId)),
      this.dockDrag.registerExternalDrop(
        (panel: DockPanel, event: MouseEvent): boolean => this.handleMainDrop(panel, event),
      ),
    );
  }

  /**
   * Pops a panel out of the main dock into its own OS window. When it is already popped out, its
   * window is focused and the panel revealed there instead.
   * @param panelId The panel identifier.
   * @param at The screen position to open the window at, or undefined for the persisted bounds.
   */
  public popOut(panelId: string, at?: AuxiliaryWindowPosition): void {
    const existing: PopoutWindow | undefined = this.windowOf(panelId);
    if (existing !== undefined) {
      existing.window.focus();
      existing.reveal.reveal(panelId);
      return;
    }
    if (this.registry.get(panelId) === undefined) {
      return;
    }
    const origin: PanelOrigin = this.originOf(panelId);
    const popout: PopoutWindow | null = this.openWindow(panelId, at);
    if (popout === null) {
      return;
    }
    this.origins.set(panelId, origin);
    this.dockState.removeFromLayout(panelId);
    this.trackPanel(popout, panelId);
  }

  /**
   * Opens a pop-out window hosting a dock seeded with the given panel. The window is titled after
   * the workspace (or repository) that owns this view.
   * @param panelId The identifier of the panel the dock starts with.
   * @param at The screen position to open the window at, or undefined for the persisted bounds.
   * @returns Returns the window, or null when it could not be opened.
   */
  private openWindow(panelId: string, at?: AuxiliaryWindowPosition): PopoutWindow | null {
    const root: string | null = this.context.root();
    const title: string =
      root === null ? 'ONIXLabs Studio' : (root.split(/[\\/]/).pop() ?? root);
    const window: AuxiliaryWindow | null = this.aux.open(title, at);
    if (window === null) {
      return null;
    }
    const document: Document = window.contentHost.ownerDocument;

    // The dock host provides the window's own dock services (state, geometry, drag, …) as
    // component providers; the config below reaches them through a plain value injector, and the
    // parent chain continues into this view's injector for everything else.
    const host: ComponentRef<PopoutDockHost> = createComponent(PopoutDockHost, {
      environmentInjector: this.environmentInjector,
      elementInjector: Injector.create({
        providers: [{ provide: POPOUT_DOCK_CONFIG, useValue: { document, panelId } }],
        parent: this.injector,
      }),
      hostElement: window.contentHost.appendChild(document.createElement('div')),
    });
    this.applicationRef.attachView(host.hostView);

    const popout: PopoutWindow = {
      window,
      document,
      host,
      state: host.injector.get(DockState),
      floating: host.injector.get(DockFloating),
      reveal: host.injector.get(DockReveal),
      watcher: null,
      tracked: new Set<string>(),
    };
    this.windows.push(popout);
    window.onClosed((): void => this.handleWindowClosed(popout));

    // The window's dock takes over outside drops released from ITS drags, so panels move between
    // windows and back to the main dock by the same gesture.
    this.unregister.push(
      host.injector
        .get(DockDrag)
        .registerExternalDrop(
          (panel: DockPanel, event: MouseEvent): boolean =>
            this.handleWindowDrop(popout, panel, event),
        ),
    );

    // Reconcile membership as the window's dock changes: a panel closed there leaves the popped
    // set entirely (exactly as a close in the main dock would), and a window with nothing left —
    // docked or floating — closes itself.
    popout.watcher = effect(
      (): void => {
        const ids: Set<string> = new Set<string>(collectPanelIds(popout.state.layout()));
        for (const float of popout.floating.floats()) {
          ids.add(float.panelId);
        }
        untracked((): void => this.reconcile(popout, ids));
      },
      { injector: this.injector },
    );
    return popout;
  }

  /**
   * Records a panel as living in the given window, so reveals focus it there.
   * @param popout The hosting window.
   * @param panelId The panel identifier.
   */
  private trackPanel(popout: PopoutWindow, panelId: string): void {
    popout.tracked = new Set<string>([...popout.tracked, panelId]);
    this.popouts.markPopped(panelId, (): void => {
      popout.window.focus();
      popout.reveal.reveal(panelId);
    });
  }

  /**
   * Adds a panel to an existing window's dock, tabbed into its first tool stack.
   * @param popout The hosting window.
   * @param panelId The panel identifier.
   */
  private addToWindow(popout: PopoutWindow, panelId: string): void {
    const stack: StackNode | null = firstStackOfRole(popout.state.layout(), 'tool');
    if (stack !== null) {
      popout.state.tabInto(stack.id, panelId);
    } else {
      popout.state.dockEdge(panelId, 'bottom');
    }
    this.trackPanel(popout, panelId);
    popout.reveal.reveal(panelId);
    popout.window.focus();
  }

  /**
   * Handles a drag released over none of the MAIN dock's targets: a drop onto an open pop-out
   * window joins its dock; a drop beyond the window edge tears the panel out into a new window at
   * the drop point. In-window void drops are declined (the dock floats the panel, as ever), as are
   * document panels — only tool panels pop out.
   * @param panel The dragged panel.
   * @param event The release event.
   * @returns Returns true when the drop was consumed.
   */
  private handleMainDrop(panel: DockPanel, event: MouseEvent): boolean {
    if (panel.role !== 'tool') {
      return false;
    }
    const outside: boolean =
      event.clientX < 0 ||
      event.clientY < 0 ||
      event.clientX > window.innerWidth ||
      event.clientY > window.innerHeight;
    if (!outside) {
      return false;
    }
    const target: PopoutWindow | null = this.windowAt(event.screenX, event.screenY);
    if (target !== null) {
      this.origins.set(panel.id, this.originOf(panel.id));
      this.dockState.removeFromLayout(panel.id);
      this.addToWindow(target, panel.id);
      return true;
    }
    this.popOut(panel.id, {
      x: event.screenX - TEAR_OFFSET.x,
      y: event.screenY - TEAR_OFFSET.y,
    });
    return true;
  }

  /**
   * Handles a drag released over none of a POP-OUT window dock's targets: over the main window the
   * panel returns to the dock position it originally left; over another pop-out window it moves
   * into that window's dock; over neither it tears out into a new window at the drop point. Drops
   * inside the window itself are declined (its dock floats the panel).
   * @param source The window the drag came from.
   * @param panel The dragged panel.
   * @param event The release event.
   * @returns Returns true when the drop was consumed.
   */
  private handleWindowDrop(source: PopoutWindow, panel: DockPanel, event: MouseEvent): boolean {
    const view: Window | null = source.document.defaultView;
    if (view === null) {
      return false;
    }
    const outside: boolean =
      event.clientX < 0 ||
      event.clientY < 0 ||
      event.clientX > view.innerWidth ||
      event.clientY > view.innerHeight;
    if (!outside) {
      return false;
    }

    const target: PopoutWindow | null = this.windowAt(event.screenX, event.screenY);
    if (target !== null && target !== source) {
      source.state.removeFromLayout(panel.id);
      this.addToWindow(target, panel.id);
      return true;
    }
    if (target === source) {
      return false;
    }

    const overMain: boolean =
      event.screenX >= window.screenX &&
      event.screenX <= window.screenX + window.outerWidth &&
      event.screenY >= window.screenY &&
      event.screenY <= window.screenY + window.outerHeight;
    if (overMain) {
      source.state.removeFromLayout(panel.id);
      this.returnToMain(panel.id);
      return true;
    }

    source.state.removeFromLayout(panel.id);
    const created: PopoutWindow | null = this.openWindow(panel.id, {
      x: event.screenX - TEAR_OFFSET.x,
      y: event.screenY - TEAR_OFFSET.y,
    });
    if (created === null) {
      // The new window could not open; fall back to returning the panel home.
      this.returnToMain(panel.id);
      return true;
    }
    this.trackPanel(created, panel.id);
    return true;
  }

  /**
   * Returns a popped panel to the main dock, to the position it originally left, and reveals it.
   * @param panelId The panel identifier.
   */
  private returnToMain(panelId: string): void {
    const origin: PanelOrigin = this.origins.get(panelId) ?? null;
    this.origins.delete(panelId);
    this.popouts.clear(panelId);
    this.restorePanel(panelId, origin);
    this.dockReveal.reveal(panelId);
  }

  /**
   * Reconciles a window's tracked panels against its dock's current membership: panels that left
   * the window through this coordinator's own moves are simply untracked; panels that vanished
   * otherwise were closed by the user inside the window and leave the popped set. A window with
   * nothing left closes itself.
   * @param popout The window to reconcile.
   * @param current The panel identifiers currently in the window's dock (docked or floating).
   */
  private reconcile(popout: PopoutWindow, current: ReadonlySet<string>): void {
    if (this.destroyed) {
      return;
    }
    for (const panelId of popout.tracked) {
      if (current.has(panelId)) {
        continue;
      }
      // Gone from this window's dock. When it now lives in another window or back in the main
      // layout, this was one of the coordinator's own moves and its state is already up to date;
      // otherwise the user closed it inside the window, and it leaves the popped set entirely.
      const movedElsewhere: boolean =
        this.windows.some(
          (other: PopoutWindow): boolean => other !== popout && other.tracked.has(panelId),
        ) || findStackOfPanel(this.dockState.layout(), panelId) !== null;
      if (!movedElsewhere) {
        this.origins.delete(panelId);
        this.popouts.clear(panelId);
      }
    }
    popout.tracked = new Set<string>(current);
    if (current.size === 0 && this.windows.includes(popout)) {
      popout.window.close();
    }
  }

  /**
   * Handles a pop-out window having closed, returning every panel it still hosts to the main dock
   * and revealing the first of them.
   * @param popout The closed window.
   */
  private handleWindowClosed(popout: PopoutWindow): void {
    if (this.destroyed) {
      return;
    }
    const index: number = this.windows.indexOf(popout);
    if (index !== -1) {
      this.windows.splice(index, 1);
    }
    popout.watcher?.destroy();
    popout.watcher = null;
    const returning: readonly string[] = [...popout.tracked];
    popout.tracked = new Set<string>();
    this.applicationRef.detachView(popout.host.hostView);
    popout.host.destroy();
    for (const panelId of returning) {
      const origin: PanelOrigin = this.origins.get(panelId) ?? null;
      this.origins.delete(panelId);
      this.popouts.clear(panelId);
      this.restorePanel(panelId, origin);
    }
    if (returning.length > 0) {
      this.dockReveal.reveal(returning[0]);
    }
  }

  /**
   * Finds the pop-out window currently hosting a panel.
   * @param panelId The panel identifier.
   * @returns Returns the window, or undefined when the panel is not popped.
   */
  private windowOf(panelId: string): PopoutWindow | undefined {
    return this.windows.find((popout: PopoutWindow): boolean => popout.tracked.has(panelId));
  }

  /**
   * Finds the newest pop-out window under a screen point.
   * @param screenX The point's screen x coordinate.
   * @param screenY The point's screen y coordinate.
   * @returns Returns the window, or null when the point is over none.
   */
  private windowAt(screenX: number, screenY: number): PopoutWindow | null {
    for (let index: number = this.windows.length - 1; index >= 0; index--) {
      if (this.windows[index].window.containsScreenPoint(screenX, screenY)) {
        return this.windows[index];
      }
    }
    return null;
  }

  /**
   * Captures a panel's current main-dock position, for restoring it on dock-back.
   * @param panelId The panel identifier.
   * @returns Returns the position, or null when the panel is not in the layout.
   */
  private originOf(panelId: string): PanelOrigin {
    const stack: StackNode | null = findStackOfPanel(this.dockState.layout(), panelId);
    return stack === null ? null : { stackId: stack.id, index: stack.panels.indexOf(panelId) };
  }

  /**
   * Restores a panel to the main dock: to the stack and tab index it left when they still exist,
   * otherwise docked to the bottom edge.
   * @param panelId The panel identifier.
   * @param origin The dock position the panel left, or null when unknown.
   */
  private restorePanel(panelId: string, origin: PanelOrigin): void {
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
   * Closes every pop-out window when the owning view goes away. The panels are not re-docked — the
   * view's dock is being destroyed with them.
   */
  public ngOnDestroy(): void {
    this.destroyed = true;
    for (const dispose of this.unregister) {
      dispose();
    }
    for (const popout of [...this.windows]) {
      popout.watcher?.destroy();
      popout.watcher = null;
      this.applicationRef.detachView(popout.host.hostView);
      popout.host.destroy();
      popout.window.close();
    }
    this.windows.length = 0;
    this.origins.clear();
  }
}
