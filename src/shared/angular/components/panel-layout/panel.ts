import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { PANEL_LAYOUT_CONTEXT, PanelLayoutContext } from './panel-layout-context';
import { clampPanelWidth, PanelEdge, PanelPlacement } from './panel-types';

/**
 * Represents a single edge-docked panel within an {@link PanelLayout}. The panel hosts arbitrary
 * projected content (typically a shared capability wrapper such as `<app-terminal>` or
 * `<app-agent>`) and declares where it opens by default; where it actually lives is the user's
 * choice, resolved from the layout's arrangement and changed by dragging the panel's header onto
 * another edge. Hiding a panel collapses it without destroying its content, so a hosted session
 * survives being closed and reopened.
 *
 * Panels stacked on one edge tile side by side. On left and right edges each panel keeps its own
 * width (its leading divider, or the layout's grip for the innermost panel, resizes that one panel,
 * and the edge grows to the sum). On top and bottom edges the panels share the edge's width and one
 * resizable height, and their dividers rebalance that shared length.
 */
@Component({
  selector: 'app-panel',
  templateUrl: './panel.html',
  styleUrl: './panel.scss',
  host: {
    class: 'panel',
    '[attr.data-edge]': 'edge()',
    '[class.panel--hidden]': '!visible()',
    '[style.flex]': 'flexValue()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Panel {
  /**
   * Specifies the default size, in pixels, a panel opens at when none is stored.
   */
  private static readonly DEFAULT_SIZE: number = 320;

  /**
   * Specifies the default minimum size, in pixels, a panel can be dragged to.
   */
  private static readonly DEFAULT_MIN_SIZE: number = 120;

  /**
   * Specifies the default maximum size, in pixels, a panel can be dragged to.
   */
  private static readonly DEFAULT_MAX_SIZE: number = 900;

  /**
   * Holds the owning layout's context, or null when the panel is hosted outside a layout.
   */
  private readonly context: PanelLayoutContext | null = inject(PANEL_LAYOUT_CONTEXT, {
    optional: true,
  });

  /**
   * Holds the panel's host element, measured for the drag ghost.
   */
  private readonly elementRef: ElementRef<HTMLElement> =
    inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Gets the stable identifier the panel's placement is stored under.
   */
  public readonly panelId: InputSignal<string> = input.required<string>();

  /**
   * Gets the edge the panel docks to when no placement is stored. Left and right panels span the
   * layout's full height; top and bottom panels fit between them.
   */
  public readonly defaultEdge: InputSignal<PanelEdge> = input<PanelEdge>('right');

  /**
   * Gets the cross-axis size, in pixels, the panel opens at when no placement is stored.
   */
  public readonly defaultSize: InputSignal<number> = input<number>(Panel.DEFAULT_SIZE);

  /**
   * Gets a value indicating whether the panel is shown. When false the panel collapses to nothing
   * but its content stays mounted.
   */
  public readonly visible: InputSignal<boolean> = input<boolean>(true);

  /**
   * Gets the smallest cross-axis size, in pixels, the panel's edge can be dragged to.
   */
  public readonly minSize: InputSignal<number> = input<number>(Panel.DEFAULT_MIN_SIZE);

  /**
   * Gets the largest cross-axis size, in pixels, the panel's edge can be dragged to.
   */
  public readonly maxSize: InputSignal<number> = input<number>(Panel.DEFAULT_MAX_SIZE);

  /**
   * Gets the panel's resolved placement: its stored placement when one exists, or its declared
   * defaults.
   */
  public readonly placement: Signal<PanelPlacement> = computed((): PanelPlacement => {
    const stored: PanelPlacement | undefined = this.context?.arrangement()[this.panelId()];
    return stored ?? { edge: this.defaultEdge(), order: 0, size: this.defaultSize() };
  });

  /**
   * Gets the edge the panel is docked to.
   */
  public readonly edge: Signal<PanelEdge> = computed((): PanelEdge => this.placement().edge);

  /**
   * Gets the panel's host element, measured for the drag ghost.
   */
  public get hostElement(): HTMLElement {
    return this.elementRef.nativeElement;
  }

  /**
   * Gets the host's flex value: a collapsed zero track when hidden (the content stays mounted); a
   * fixed own width on left and right edges, where panels tile as columns each at their own size;
   * or a shared grow/shrink share on top and bottom edges, where panels divide the edge's width.
   * The shares map doubles as the live width override during a left/right resize drag.
   */
  protected readonly flexValue: Signal<string> = computed((): string => {
    if (!this.visible()) {
      return '0 0 0%';
    }
    const override: number | undefined = this.context?.shares()[this.panelId()];
    if (this.edge() === 'left' || this.edge() === 'right') {
      const width: number = clampPanelWidth(
        override ?? this.placement().size,
        this.minSize(),
        this.maxSize(),
        window.innerWidth,
      );
      return `0 0 ${width}px`;
    }
    const share: number = override ?? 1;
    return `${share} ${share} 0%`;
  });

  /**
   * Gets a value indicating whether the panel carries a leading divider: every visible member of
   * an edge stack but the first does, so adjacent panels can be rebalanced.
   */
  protected readonly dividerVisible: Signal<boolean> = computed((): boolean => {
    if (this.context === null || !this.visible()) {
      return false;
    }
    return this.context.visibleStack(this.edge()).indexOf(this.panelId()) > 0;
  });

  /**
   * Gets a value indicating whether the panel's divider is being dragged.
   */
  protected readonly dividerActive: Signal<boolean> = computed(
    (): boolean => this.context?.activeDivider() === this.panelId(),
  );

  /**
   * Gets the ARIA orientation of the divider. Every edge now tiles its panels side by side, so
   * every divider is a vertical strip separating two neighbours horizontally.
   */
  protected readonly dividerOrientation: Signal<'horizontal' | 'vertical'> = computed(
    (): 'horizontal' | 'vertical' => 'vertical',
  );

  /**
   * Begins a divider drag, rebalancing the panel against its predecessor in the stack.
   * @param event The pointer-down event that started the drag.
   */
  protected onDividerDown(event: MouseEvent): void {
    this.context?.beginDividerDrag(this.panelId(), event);
  }
}
