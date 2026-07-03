import { CdkDrag, CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { DockAutoHide } from '../../../services/dock/dock-auto-hide';
import { DockDrag } from '../../../services/dock/dock-drag';
import { DockFloating } from '../../../services/dock/dock-floating';
import { DockFocus } from '../../../services/dock/dock-focus';
import { DockGeometry } from '../../../services/dock/dock-geometry';
import { guideLegality, Rect } from '../../../services/dock/dock-legality';
import { DockPanel } from '../../../services/dock/dock-panel';
import { DockPanelRegistry } from '../../../services/dock/dock-panel-registry';
import { DockSide, StackNode } from '../../../services/dock/dock-node';
import { DockState } from '../../../services/dock/dock-state';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Menu, MenuItem } from '@shared/angular/components/menu/menu';
import { DockPanelOutlet } from '../dock-panel-outlet/dock-panel-outlet';
import { DockStatusStrip } from '../dock-status-strip/dock-status-strip';
import { DockTool, DockToolStrip } from '../dock-tool-strip/dock-tool-strip';

/**
 * The rectangle a panel floats into when its group cannot be measured.
 */
const FALLBACK_FLOAT_RECT: Rect = { left: 120, top: 120, width: 360, height: 240 };

/**
 * Represents a tabbed group of panels (a stack) in the dock layout. Tool stacks render a title bar
 * above the tab strip; document stacks render the tab strip on top with no title bar. The tab strip
 * is a connected CDK drop list, so tabs reorder within and move between same-role groups; dragging
 * a tool group's title bar starts a compass dock through {@link DockDrag} (tab-into, split, edge or
 * float); the title buttons float the active panel or auto-hide the stack.
 */
@Component({
  selector: 'app-dock-tab-group',
  imports: [
    DockPanelOutlet,
    DockToolStrip,
    DockStatusStrip,
    CdkDropList,
    CdkDrag,
    CdkMenuTrigger,
    Menu,
    AppIcon,
  ],
  templateUrl: './dock-tab-group.html',
  styleUrl: './dock-tab-group.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.dock-tab-group--documents]': 'isDocuments()',
    '[class.dock-tab-group--tool]': '!isDocuments()',
    '[class.dock-tab-group--focused]': 'isFocused()',
    '[class.dock-tab-group--tabs-fill]': 'tabsFill()',
    '(mousedown)': 'focusPanel()',
  },
})
export class DockTabGroup {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

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
   * Holds the focus tracker that decides which panel is accented.
   */
  private readonly dockFocus: DockFocus = inject(DockFocus);

  /**
   * Holds this group's element, hit-tested during a compass drag.
   */
  private readonly hostElement: ElementRef<HTMLElement> = inject(
    ElementRef,
  ) as ElementRef<HTMLElement>;

  /**
   * Holds the tab strip element, measured to decide when the tabs should fill the strip.
   */
  private readonly tabstrip: Signal<ElementRef<HTMLElement> | undefined> =
    viewChild<ElementRef<HTMLElement>>('tabstrip');

  /**
   * Holds whether the tabs should fill the strip (their natural width is within the fill threshold of
   * the strip's width), as opposed to staying content-sized with free space at the end.
   */
  private readonly tabsFillSignal: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets a value indicating whether the tabs fill the strip. Tabs stay content-sized until their
   * natural width comes within ~1rem of the strip's width, then flip to grow and share it (so the last
   * tab reaches the end edge and the end-corner merge applies). Tool stacks only; a document well's
   * strip ends with its picker controls.
   */
  protected readonly tabsFill: Signal<boolean> = this.tabsFillSignal.asReadonly();

  /**
   * Gets the stack this group renders.
   */
  public readonly stack: InputSignal<StackNode> = input.required<StackNode>();

  /**
   * Gets the edge of its slot the panel hugs, which sets the collapse button's icon and rotation.
   */
  public readonly side: InputSignal<DockSide> = input<DockSide>('left');

  /**
   * Gets the collapse button's icon, chosen by the docked edge's axis.
   */
  protected readonly collapseIcon: Signal<Icon> = computed(
    (): Icon =>
      this.side() === 'top' || this.side() === 'bottom'
        ? Icon.COLLAPSE_VERTICAL
        : Icon.COLLAPSE_HORIZONTAL,
  );

  /**
   * Gets the collapse button's rotation in degrees: the left and top edges flip the icon 180°.
   */
  protected readonly collapseRotation: Signal<number> = computed((): number =>
    this.side() === 'left' || this.side() === 'top' ? 180 : 0,
  );

  /**
   * Gets the panels held by the stack as document-picker menu items.
   */
  protected readonly documentItems: Signal<readonly MenuItem[]> = computed(
    (): readonly MenuItem[] =>
      this.panels().map(
        (panel: DockPanel): MenuItem => ({ id: panel.id, label: panel.title, icon: panel.icon }),
      ),
  );

  /**
   * Gets the stubbed tools shown in a document well's tool strip, distinct from the default panel
   * tools so the well reads as an editor surface.
   */
  protected readonly documentTools: readonly DockTool[] = [
    { id: 'split', icon: Icon.LAYOUT_SPLIT, label: 'Split Editor' },
    { id: 'find', icon: Icon.SEARCH, label: 'Find in File' },
    { id: 'settings', icon: Icon.SETTINGS, label: 'Editor Settings' },
    { id: 'more', icon: Icon.GRID_DOTS, label: 'More Actions' },
  ];

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
   * Gets a value indicating whether this group is the focused panel.
   */
  protected readonly isFocused: Signal<boolean> = computed(
    (): boolean => this.dockFocus.focusedStackId() === this.stack().id,
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
    const destroyRef: DestroyRef = inject(DestroyRef);

    afterNextRender((): void => {
      const stack: StackNode = this.stack();
      this.geometry.registerGroup(stack.id, stack.role, this.hostElement.nativeElement);

      // Re-measure whenever the strip is resized (the panel narrows or widens).
      const strip: HTMLElement | undefined = this.tabstrip()?.nativeElement;
      if (strip !== undefined && typeof ResizeObserver !== 'undefined') {
        const observer: ResizeObserver = new ResizeObserver((): void => this.measureTabsFill());
        observer.observe(strip);
        destroyRef.onDestroy((): void => observer.disconnect());
      }
      this.measureTabsFill();
    });

    destroyRef.onDestroy((): void => this.geometry.unregisterGroup(this.stack().id));

    // Re-measure after the tab set changes (open/close/reorder/rename), once the DOM has settled.
    effect((): void => {
      this.panels();
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame((): void => this.measureTabsFill());
      }
    });
  }

  /**
   * Measures whether the tabs should fill the strip and updates the flag that flips them from
   * content-sized to filling (and gates the end-corner merge). The last tab's end position is read
   * with the tabs forced back to their content size (via the `data-measuring` attribute) so the result
   * does not depend on whether they are currently filling — otherwise a filled strip would always
   * re-measure as full and never relax back. The attribute is set and cleared within this synchronous
   * pass, so it never paints. Only tool stacks qualify; a document well's strip ends with its picker
   * controls, so its last tab never meets the edge.
   */
  private measureTabsFill(): void {
    const strip: HTMLElement | undefined = this.tabstrip()?.nativeElement;
    if (strip === undefined || this.isDocuments()) {
      this.tabsFillSignal.set(false);
      return;
    }

    const tabs: NodeListOf<HTMLElement> = strip.querySelectorAll<HTMLElement>('.dock-tab');
    const last: HTMLElement | null = tabs.item(tabs.length - 1);
    if (last === null) {
      this.tabsFillSignal.set(false);
      return;
    }

    strip.setAttribute('data-measuring', '');
    const stripRight: number = strip.getBoundingClientRect().right;
    const lastTabRight: number = last.getBoundingClientRect().right;
    strip.removeAttribute('data-measuring');

    // Fill once the content-sized tabs come within the threshold of the strip's end edge (or already
    // overflow it, in which case they shrink to fit and reach the end anyway).
    const FILL_THRESHOLD_PX: number = 16; // ~1rem
    this.tabsFillSignal.set(stripRight - lastTabRight <= FILL_THRESHOLD_PX);
  }

  /**
   * Focuses this panel so it becomes the accented one. Fired on any press within the group.
   */
  protected focusPanel(): void {
    this.dockFocus.focus(this.stack().id);
  }

  /**
   * Determines whether a dragged tab may enter this group's tab strip, enforcing that documents
   * only drop into document wells and tools only into tool stacks.
   * @param drag The tab being dragged, whose data is the panel identifier.
   * @returns Returns true when the tab may drop here; otherwise, false.
   */
  protected readonly canEnter: (drag: CdkDrag<string>) => boolean = (
    drag: CdkDrag<string>,
  ): boolean => {
    const panel: DockPanel | undefined = this.registry.get(drag.data);
    return panel !== undefined && guideLegality(panel.role, this.stack().role).center;
  };

  /**
   * Commits a tab drop, reordering within this group or moving the tab in from another group.
   * @param event The CDK drop event.
   */
  protected onDrop(event: CdkDragDrop<StackNode>): void {
    const panelId: string = event.item.data as string;
    if (event.previousContainer === event.container) {
      this.dockState.reorderTab(this.stack().id, event.previousIndex, event.currentIndex);
    } else {
      this.dockState.movePanel(panelId, this.stack().id, event.currentIndex);
    }
  }

  /**
   * Activates the panel with the given identifier.
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
