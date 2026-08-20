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
import { Log } from '@shared/angular/services/log/log';
import { DockAutoHide } from '../../../services/dock-layout/dock-auto-hide';
import { DockDrag } from '../../../services/dock-layout/dock-drag';
import { DockFloating } from '../../../services/dock-layout/dock-floating';
import { DockFocus } from '../../../services/dock-layout/dock-focus';
import { DockGeometry } from '../../../services/dock-layout/dock-geometry';
import { Rect } from '../../../services/dock-layout/dock-legality';
import { DockPanel } from '../../../services/dock-layout/dock-panel';
import { DockPanelRegistry } from '../../../services/dock-layout/dock-panel-registry';
import { DockSide, StackNode } from '../../../services/dock-layout/dock-node';
import { DockState } from '../../../services/dock-layout/dock-state';
import { PopoutPanels } from '../../../services/dock-layout/popout-panels';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
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
 * is a connected CDK drop list, so tabs reorder within and move between same-role groups; the title
 * buttons float the active panel or auto-hide the stack.
 *
 * Two compass drags start here, and the difference between them is what moves. Dragging a tool
 * group's title bar — or a document well's grip, which stands in for the title bar it does not have
 * — docks the **active panel** alone (tab-into, split, edge or float). Dragging the **tab rail**
 * itself docks the **whole group**, every tab travelling together, for tool stacks and document
 * wells alike. Both run through {@link DockDrag}.
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
    Button,
  ],
  templateUrl: './dock-tab-group.html',
  styleUrl: './dock-tab-group.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.dock-tab-group--documents]': 'isDocuments()',
    '[class.dock-tab-group--tool]': '!isDocuments()',
    '[class.dock-tab-group--empty]': 'isEmpty()',
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
   * Holds the pop-out seam: panels with a registered pop-out handler get the title-bar pop-out
   * button, which moves them into their own OS window.
   */
  private readonly popouts: PopoutPanels = inject(PopoutPanels);

  /**
   * Holds the focus tracker that decides which panel is accented.
   */
  private readonly dockFocus: DockFocus = inject(DockFocus);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

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
    { id: 'settings', icon: Icon.SETTINGS, iconRotation: 30, label: 'Editor Settings' },
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
   * Gets a value indicating whether the active document can be dragged out of the well into a separate
   * group: only when the well holds more than one document, so dragging it out leaves the well behind.
   */
  protected readonly canDetachActive: Signal<boolean> = computed(
    (): boolean => this.stack().panels.length > 1,
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
   * Determines whether a dragged tab may enter this group's tab strip, enforcing that a strip only
   * ever holds panels of its own role — documents into document wells, tools into tool stacks. This
   * is literal tab-strip membership, distinct from the compass's occupy rule: a tool taking over an
   * empty centre well replaces the well (a compass drop through {@link DockDrag}), it never becomes a
   * tab in a documents-only strip, so that case must not enter here.
   * @param drag The tab being dragged, whose data is the panel identifier.
   * @returns Returns true when the tab may drop here; otherwise, false.
   */
  protected readonly canEnter: (drag: CdkDrag<string>) => boolean = (
    drag: CdkDrag<string>,
  ): boolean => {
    const panel: DockPanel | undefined = this.registry.get(drag.data);
    return panel?.role === this.stack().role;
  };

  /**
   * Commits a tab drop, reordering within this group or moving the tab in from another group.
   * @param event The CDK drop event.
   */
  protected onDrop(event: CdkDragDrop<StackNode>): void {
    const panelId: string = event.item.data as string;
    if (event.previousContainer === event.container) {
      this.log.debug(
        'DockTabGroup',
        `Reordered tab '${panelId}' within stack '${this.stack().id}'`,
      );
      this.dockState.reorderTab(this.stack().id, event.previousIndex, event.currentIndex);
    } else {
      this.log.info('DockTabGroup', `Moved tab '${panelId}' into stack '${this.stack().id}'`);
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
    void this.dockState.requestClose(panelId);
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
   * Gets a value indicating whether the active panel can pop out into its own OS window (the view
   * provides a pop-out handler). The button renders on every tool group either way, so the chrome
   * stays consistent; it is disabled in views without pop-out support.
   */
  protected readonly canPopOutActive: Signal<boolean> = computed(
    (): boolean => this.stack().active !== null && this.popouts.canPopOut(),
  );

  /**
   * Gets the pop-out button's tooltip, explaining the disabled state when the view has no pop-out
   * support.
   */
  protected readonly popOutTitle: Signal<string> = computed((): string =>
    this.canPopOutActive() ? 'Open in New Window' : 'Open in New Window (not available here)',
  );

  /**
   * Pops the active panel out into its own OS window through its registered handler.
   */
  protected popOutActive(): void {
    const active: string | null = this.stack().active;
    if (active !== null) {
      this.popouts.popOut(active);
    }
  }

  /**
   * Auto-hides the stack, shelving it to the edge of its slot it is already hugging. That edge is
   * handed over so the collapsed strip keeps it even if the tree is rearranged around it later.
   */
  protected requestPin(): void {
    this.autoHide.pin(this.stack().id, this.side());
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

  /**
   * Starts a compass dock for the whole group from the tab rail, so the stack docks with every tab
   * it holds — the counterpart to the title bar, which moves the active panel alone. Only presses on
   * the rail itself qualify: a press that lands on a tab is that tab's own CDK drag (reorder within
   * the strip, or move between strips), and a press on the well's trailing controls belongs to them.
   * @param event The originating mouse event.
   */
  protected startGroupDrag(event: MouseEvent): void {
    if (event.target !== event.currentTarget) {
      return;
    }
    this.dockDrag.beginGroup(this.stack().id, event);
  }
}
