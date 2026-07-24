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
  AuxiliaryWindowPosition,
} from '@shared/angular/services/auxiliary-windows/auxiliary-windows';
import { PopoutTabStrip } from '@shared/angular/components/popout-tab-strip/popout-tab-strip';
import { DockDrag } from '@shared/angular/services/dock-layout/dock-drag';
import { DockNode, StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { findNode, findStackOfPanel } from '@shared/angular/services/dock-layout/dock-tree';
import { PopoutPanels } from '@shared/angular/services/dock-layout/popout-panels';

/**
 * The dock position a panel left, so docking back restores it: the stack it was in and its tab
 * index there. Null when the panel was not in the layout when popped.
 */
type PanelOrigin = { readonly stackId: string; readonly index: number } | null;

/**
 * One hosted panel inside a pop-out window: its component, the host element its tab shows and
 * hides, and where in the dock it came from.
 */
interface HostedPanel {
  /**
   * Gets the panel descriptor.
   */
  readonly panel: DockPanel;

  /**
   * Gets the panel component rendered into the window.
   */
  readonly component: ComponentRef<unknown>;

  /**
   * Gets the element hosting the component, shown only while the panel's tab is active.
   */
  readonly host: HTMLElement;

  /**
   * Gets the dock position the panel left.
   */
  readonly origin: PanelOrigin;
}

/**
 * One pop-out window's bookkeeping: the auxiliary window, the panels it hosts in tab order, the
 * active tab, and the tab strip shown once a second panel joins.
 */
interface PopoutWindow {
  /**
   * Gets the auxiliary window hosting the panels.
   */
  readonly window: AuxiliaryWindow;

  /**
   * Gets the hosted panels by identifier.
   */
  readonly parts: Map<string, HostedPanel>;

  /**
   * Gets the panel identifiers in tab order.
   */
  order: string[];

  /**
   * Gets the identifier of the visible panel, or null while the window empties.
   */
  active: string | null;

  /**
   * Gets the tab strip rendered into the window's chrome, or null while it hosts a single panel.
   */
  strip: ComponentRef<PopoutTabStrip> | null;
}

/**
 * The offset, in pixels, from the tear-out drop point to the new window's top-left, so the window
 * materialises with its title bar under the cursor rather than exactly at it.
 */
const TEAR_OFFSET: { readonly x: number; readonly y: number } = { x: 60, y: 20 };

/**
 * The pop-out coordinator: moves ANY dock panel into its own OS window and back. It registers as
 * the {@link PopoutPanels} handler; a popped panel is hosted through an auxiliary window, where the
 * panel component renders into the child document with THIS view's injector. The panel therefore
 * keeps its real services — diagnostics, logs, debug state, the terminal sessions, the agent
 * conversation — and its actions (revealing a document, running a search) land in this workspace
 * exactly as if it were docked. Panels whose state lives outside the component (the terminal's
 * PTYs and retained scrollback in the main process) survive the move the same way they survive any
 * remount: the popped component re-attaches and replays.
 *
 * A window hosts one panel or several: it also registers as the dock drag's external drop handler,
 * so a tool tab dragged beyond the window edge tears out into a new window at the drop point, and
 * one dropped onto an open pop-out window joins it as a tab (a {@link PopoutTabStrip} appears in
 * the window's chrome). Closing a window returns every panel it hosts to the stack and tab
 * position it left. Provided per view alongside the dock services, and instantiated eagerly so the
 * dock chrome offers pop-out from the first render.
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
   * Holds the dock drag this coordinator takes outside drops from.
   */
  private readonly dockDrag: DockDrag = inject(DockDrag);

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
   * Holds the open pop-out windows, oldest first.
   */
  private readonly windows: PopoutWindow[] = [];

  /**
   * Holds each popped panel's hosting window.
   */
  private readonly byPanel: Map<string, PopoutWindow> = new Map<string, PopoutWindow>();

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
   * handler for every panel and as the dock drag's outside-drop handler.
   */
  public constructor() {
    this.unregister.push(
      this.popouts.register((panelId: string): void => this.popOut(panelId)),
      this.dockDrag.registerExternalDrop(
        (panel: DockPanel, event: MouseEvent): boolean => this.handleExternalDrop(panel, event),
      ),
    );
  }

  /**
   * Pops a panel out into its own OS window, remembering where in the dock it came from. When it is
   * already popped out, its window is focused and its tab activated instead.
   * @param panelId The panel identifier.
   * @param at The screen position to open the window at, or undefined for the persisted bounds.
   */
  public popOut(panelId: string, at?: AuxiliaryWindowPosition): void {
    const existing: PopoutWindow | undefined = this.byPanel.get(panelId);
    if (existing !== undefined) {
      existing.window.focus();
      this.activate(existing, panelId);
      return;
    }
    const panel: DockPanel | undefined = this.registry.get(panelId);
    if (panel === undefined) {
      return;
    }

    const origin: PanelOrigin = this.originOf(panelId);
    const window: AuxiliaryWindow | null = this.aux.open(panel.title, at);
    if (window === null) {
      return;
    }
    const popout: PopoutWindow = { window, parts: new Map<string, HostedPanel>(), order: [], active: null, strip: null };
    this.windows.push(popout);
    window.onClosed((): void => this.handleWindowClosed(popout));
    this.dockState.removeFromLayout(panelId);
    this.addPanel(popout, panel, origin);
  }

  /**
   * Handles a drag released over none of the dock's own targets: a drop onto an open pop-out
   * window moves the panel into it as a tab; a drop beyond the window edge tears the panel out
   * into a new window at the drop point. In-window void drops are declined (the dock floats the
   * panel, as ever), as are document panels — only tool panels pop out.
   * @param panel The dragged panel.
   * @param event The release event.
   * @returns Returns true when the drop was consumed.
   */
  private handleExternalDrop(panel: DockPanel, event: MouseEvent): boolean {
    if (panel.role !== 'tool' || this.byPanel.has(panel.id)) {
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
    // Newest window first, matching the likely stacking order when pop-outs overlap.
    for (let index: number = this.windows.length - 1; index >= 0; index--) {
      const target: PopoutWindow = this.windows[index];
      if (target.window.containsScreenPoint(event.screenX, event.screenY)) {
        const origin: PanelOrigin = this.originOf(panel.id);
        this.dockState.removeFromLayout(panel.id);
        this.addPanel(target, panel, origin);
        target.window.focus();
        return true;
      }
    }
    this.popOut(panel.id, {
      x: event.screenX - TEAR_OFFSET.x,
      y: event.screenY - TEAR_OFFSET.y,
    });
    return true;
  }

  /**
   * Hosts a panel in a pop-out window: renders its component into the window's content, activates
   * its tab, and records it as popped.
   * @param popout The hosting window.
   * @param panel The panel to host.
   * @param origin The dock position the panel left.
   */
  private addPanel(popout: PopoutWindow, panel: DockPanel, origin: PanelOrigin): void {
    const host: HTMLElement = popout.window.contentHost.appendChild(
      popout.window.contentHost.ownerDocument.createElement('div'),
    );
    // The component renders into the child document but is created with THIS view's injector, so
    // it resolves the same service instances it had while docked.
    const component: ComponentRef<unknown> = createComponent(panel.component, {
      environmentInjector: this.environmentInjector,
      elementInjector: this.injector,
      hostElement: host,
    });
    component.setInput('panel', panel);
    this.applicationRef.attachView(component.hostView);

    popout.parts.set(panel.id, { panel, component, host, origin });
    popout.order = [...popout.order, panel.id];
    this.byPanel.set(panel.id, popout);
    this.popouts.markPopped(panel.id, (): void => {
      popout.window.focus();
      this.activate(popout, panel.id);
    });
    this.activate(popout, panel.id);
    this.syncStrip(popout);
  }

  /**
   * Activates a panel's tab in its window: shows its component, hides the others, and retitles the
   * window after it.
   * @param popout The hosting window.
   * @param panelId The panel identifier.
   */
  private activate(popout: PopoutWindow, panelId: string): void {
    const part: HostedPanel | undefined = popout.parts.get(panelId);
    if (part === undefined) {
      return;
    }
    popout.active = panelId;
    for (const [id, hosted] of popout.parts) {
      hosted.host.style.display = id === panelId ? '' : 'none';
    }
    popout.window.setTitle(part.panel.title);
    this.syncStrip(popout);
  }

  /**
   * Returns one panel from its window to the dock, closing the window when it empties.
   * @param popout The hosting window.
   * @param panelId The panel identifier.
   */
  private dockBackOne(popout: PopoutWindow, panelId: string): void {
    const part: HostedPanel | undefined = popout.parts.get(panelId);
    if (part === undefined) {
      return;
    }
    this.release(popout, part);
    this.restorePanel(panelId, part.origin);
    this.dockReveal.reveal(panelId);
    if (popout.parts.size === 0) {
      popout.window.close();
      return;
    }
    if (popout.active === panelId) {
      this.activate(popout, popout.order[0]);
    }
    this.syncStrip(popout);
  }

  /**
   * Handles a pop-out window having closed, returning every panel it still hosts to the dock and
   * revealing the one that was visible.
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
    const visible: string | null = popout.active;
    for (const part of [...popout.parts.values()]) {
      this.release(popout, part);
      this.restorePanel(part.panel.id, part.origin);
    }
    if (popout.strip !== null) {
      this.applicationRef.detachView(popout.strip.hostView);
      popout.strip.destroy();
      popout.strip = null;
    }
    if (visible !== null && popout.parts.size === 0) {
      this.dockReveal.reveal(visible);
    }
  }

  /**
   * Releases a hosted panel from its window's bookkeeping: destroys its component and clears its
   * popped state. The dock side (restore, reveal) is the caller's.
   * @param popout The hosting window.
   * @param part The hosted panel.
   */
  private release(popout: PopoutWindow, part: HostedPanel): void {
    popout.parts.delete(part.panel.id);
    popout.order = popout.order.filter((id: string): boolean => id !== part.panel.id);
    this.byPanel.delete(part.panel.id);
    this.applicationRef.detachView(part.component.hostView);
    part.component.destroy();
    part.host.remove();
    this.popouts.clear(part.panel.id);
  }

  /**
   * Keeps the window's tab strip in step with its panels: rendered with the current tabs while the
   * window hosts more than one, absent otherwise.
   * @param popout The hosting window.
   */
  private syncStrip(popout: PopoutWindow): void {
    if (popout.parts.size < 2) {
      if (popout.strip !== null) {
        this.applicationRef.detachView(popout.strip.hostView);
        popout.strip.destroy();
        popout.strip = null;
        popout.window.stripHost.replaceChildren();
      }
      return;
    }
    if (popout.strip === null) {
      const host: HTMLElement = popout.window.stripHost.appendChild(
        popout.window.stripHost.ownerDocument.createElement('div'),
      );
      const strip: ComponentRef<PopoutTabStrip> = createComponent(PopoutTabStrip, {
        environmentInjector: this.environmentInjector,
        elementInjector: this.injector,
        hostElement: host,
      });
      strip.instance.activated.subscribe((panelId: string): void =>
        this.activate(popout, panelId),
      );
      strip.instance.dockedBack.subscribe((panelId: string): void =>
        this.dockBackOne(popout, panelId),
      );
      this.applicationRef.attachView(strip.hostView);
      popout.strip = strip;
    }
    const panels: DockPanel[] = [];
    for (const id of popout.order) {
      const part: HostedPanel | undefined = popout.parts.get(id);
      if (part !== undefined) {
        panels.push(part.panel);
      }
    }
    popout.strip.setInput('panels', panels);
    popout.strip.setInput('activeId', popout.active);
  }

  /**
   * Captures a panel's current dock position, for restoring it on dock-back.
   * @param panelId The panel identifier.
   * @returns Returns the position, or null when the panel is not in the layout.
   */
  private originOf(panelId: string): PanelOrigin {
    const stack: StackNode | null = findStackOfPanel(this.dockState.layout(), panelId);
    return stack === null ? null : { stackId: stack.id, index: stack.panels.indexOf(panelId) };
  }

  /**
   * Restores a panel to the dock: to the stack and tab index it left when they still exist,
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
      for (const part of [...popout.parts.values()]) {
        this.release(popout, part);
      }
      if (popout.strip !== null) {
        this.applicationRef.detachView(popout.strip.hostView);
        popout.strip.destroy();
        popout.strip = null;
      }
      popout.window.close();
    }
    this.windows.length = 0;
  }
}
