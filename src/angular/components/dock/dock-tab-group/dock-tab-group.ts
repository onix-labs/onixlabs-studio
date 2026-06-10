import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { DockAutoHide } from '../../../services/dock/dock-auto-hide';
import { DockDrag } from '../../../services/dock/dock-drag';
import { DockFloating } from '../../../services/dock/dock-floating';
import { DockGeometry } from '../../../services/dock/dock-geometry';
import { Rect } from '../../../services/dock/dock-legality';
import { DockPanel } from '../../../services/dock/dock-panel';
import { DockPanelRegistry } from '../../../services/dock/dock-panel-registry';
import { StackNode } from '../../../services/dock/dock-node';
import { DockState } from '../../../services/dock/dock-state';
import { DockPanelOutlet } from '../dock-panel-outlet/dock-panel-outlet';

/**
 * The rectangle a panel floats into when its group cannot be measured.
 */
const FALLBACK_FLOAT_RECT: Rect = { left: 120, top: 120, width: 360, height: 240 };

/**
 * Represents a tabbed group of panels (a stack) in the dock layout. Tool stacks render a title bar
 * above the tab strip; document stacks render the tab strip on top with no title bar. Closing tabs
 * drives {@link DockState} directly; pressing a tab activates it and starts a compass dock through
 * {@link DockDrag} (so any tab can be tabbed-into, split, edge-docked or floated), as does dragging
 * a tool group's title bar; the title buttons float the active panel or auto-hide the stack.
 */
@Component({
  selector: 'app-dock-tab-group',
  imports: [DockPanelOutlet],
  templateUrl: './dock-tab-group.html',
  styleUrl: './dock-tab-group.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.dock-tab-group--documents]': 'isDocuments()',
  },
})
export class DockTabGroup {
  /**
   * Holds the layout state activation, closing and tab moves drive.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the registry panel ids are resolved through.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Holds the geometry registry this group registers its rectangle with.
   */
  private readonly geometry: DockGeometry = inject(DockGeometry);

  /**
   * Holds the compass drag session started from the title bar.
   */
  private readonly dockDrag: DockDrag = inject(DockDrag);

  /**
   * Holds the floating layer the float button detaches into.
   */
  private readonly floating: DockFloating = inject(DockFloating);

  /**
   * Holds the auto-hide store the pin button shelves into.
   */
  private readonly autoHide: DockAutoHide = inject(DockAutoHide);

  /**
   * Holds this group's element, hit-tested during a compass drag.
   */
  private readonly hostElement: ElementRef<HTMLElement> = inject(
    ElementRef,
  ) as ElementRef<HTMLElement>;

  /**
   * Gets the stack this group renders.
   */
  public readonly stack: InputSignal<StackNode> = input.required<StackNode>();

  /**
   * Gets a value indicating whether the stack is a document well.
   */
  protected readonly isDocuments: Signal<boolean> = computed(
    (): boolean => this.stack().role === 'document',
  );

  /**
   * Gets a value indicating whether the stack holds no panels.
   */
  protected readonly isEmpty: Signal<boolean> = computed(
    (): boolean => this.stack().panels.length === 0,
  );

  /**
   * Gets the resolved panels held by the stack, in tab order.
   */
  protected readonly panels: Signal<readonly DockPanel[]> = computed((): readonly DockPanel[] =>
    this.stack()
      .panels.map((id: string): DockPanel | undefined => this.registry.get(id))
      .filter((panel: DockPanel | undefined): panel is DockPanel => panel !== undefined),
  );

  /**
   * Gets the active panel, or undefined when the stack is empty or its active panel is unregistered.
   */
  protected readonly activePanel: Signal<DockPanel | undefined> = computed(
    (): DockPanel | undefined => {
      const active: string | null = this.stack().active;
      return active !== null ? this.registry.get(active) : undefined;
    },
  );

  /**
   * Registers and unregisters this group with the geometry registry across its lifetime.
   */
  public constructor() {
    afterNextRender((): void => {
      const stack: StackNode = this.stack();
      this.geometry.registerGroup(stack.id, stack.role, this.hostElement.nativeElement);
    });
    inject(DestroyRef).onDestroy((): void => this.geometry.unregisterGroup(this.stack().id));
  }

  /**
   * Activates a tab and starts a compass dock for it. Movement past the drag threshold docks the
   * panel elsewhere (tab-into, split, edge or float); a press without movement just activates.
   * @param panelId The identifier of the pressed panel.
   * @param event The originating mouse event.
   */
  protected onTabPress(panelId: string, event: MouseEvent): void {
    this.dockState.setActive(this.stack().id, panelId);
    this.dockDrag.begin(panelId, event);
  }

  /**
   * Activates the panel with the given identifier, used for keyboard selection.
   * @param panelId The identifier of the panel to activate.
   */
  protected activate(panelId: string): void {
    this.dockState.setActive(this.stack().id, panelId);
  }

  /**
   * Closes the panel with the given identifier, removing it from the layout.
   * @param panelId The identifier of the panel to close.
   */
  protected close(panelId: string): void {
    this.dockState.removeFromLayout(panelId);
  }

  /**
   * Floats the active panel out of the layout into a window.
   */
  protected requestFloat(): void {
    const active: string | null = this.stack().active;
    if (active !== null) {
      const rect: Rect = this.geometry.rectOf(this.stack().id) ?? FALLBACK_FLOAT_RECT;
      this.floating.float(active, rect);
    }
  }

  /**
   * Auto-hides the stack, shelving it to its nearest edge.
   */
  protected requestPin(): void {
    this.autoHide.pin(this.stack().id);
  }

  /**
   * Starts a compass dock for the active panel from the title bar.
   * @param event The originating mouse event.
   */
  protected startDrag(event: MouseEvent): void {
    const active: string | null = this.stack().active;
    if (active !== null) {
      this.dockDrag.begin(active, event);
    }
  }
}
