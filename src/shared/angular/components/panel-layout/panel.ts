import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  model,
  ModelSignal,
  Signal,
} from '@angular/core';

/**
 * Specifies the edge of the panel layout a panel docks to.
 */
export type PanelEdge = 'top' | 'right' | 'bottom' | 'left';

/**
 * Represents a single edge-docked panel within an {@link PanelLayout}. The panel hosts arbitrary
 * projected content (typically a shared capability wrapper such as `<app-terminal>` or
 * `<app-agent>`), docks to a chosen edge, and carries its own resize splitter. Hiding a panel
 * collapses it without destroying its content, so a hosted session survives being closed and
 * reopened.
 */
@Component({
  selector: 'app-panel',
  templateUrl: './panel.html',
  styleUrl: './panel.scss',
  host: {
    class: 'panel',
    '[attr.data-edge]': 'edge()',
    '[style.grid-area]': 'edge()',
    '[class.panel--hidden]': '!visible()',
    '[style.width.px]': 'widthPx()',
    '[style.height.px]': 'heightPx()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Panel {
  /**
   * Specifies the default size, in pixels, a panel opens at when none is bound.
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
   * Gets the edge the panel docks to. Left and right panels span the layout's full height; top and
   * bottom panels fit between them.
   */
  public readonly edge: InputSignal<PanelEdge> = input.required<PanelEdge>();

  /**
   * Gets a value indicating whether the panel is shown. When false the panel collapses to nothing
   * but its content stays mounted.
   */
  public readonly visible: InputSignal<boolean> = input<boolean>(true);

  /**
   * Gets or sets the panel's size in pixels along its docking axis (width for left/right, height for
   * top/bottom). Two-way bindable; the resize splitter updates it.
   */
  public readonly size: ModelSignal<number> = model<number>(Panel.DEFAULT_SIZE);

  /**
   * Gets the smallest size, in pixels, the panel can be dragged to.
   */
  public readonly minSize: InputSignal<number> = input<number>(Panel.DEFAULT_MIN_SIZE);

  /**
   * Gets the largest size, in pixels, the panel can be dragged to.
   */
  public readonly maxSize: InputSignal<number> = input<number>(Panel.DEFAULT_MAX_SIZE);

  /**
   * Gets a value indicating whether the panel docks to a vertical edge (left or right), so its size
   * controls width rather than height.
   */
  private readonly horizontal: Signal<boolean> = computed(
    (): boolean => this.edge() === 'left' || this.edge() === 'right',
  );

  /**
   * Gets the panel's effective size: its bound size when shown, or zero when hidden so it collapses.
   */
  private readonly effectiveSize: Signal<number> = computed((): number =>
    this.visible() ? this.size() : 0,
  );

  /**
   * Gets the host width in pixels for a left/right panel, or null when the panel docks top/bottom.
   */
  protected readonly widthPx: Signal<number | null> = computed((): number | null =>
    this.horizontal() ? this.effectiveSize() : null,
  );

  /**
   * Gets the host height in pixels for a top/bottom panel, or null when the panel docks left/right.
   */
  protected readonly heightPx: Signal<number | null> = computed((): number | null =>
    this.horizontal() ? null : this.effectiveSize(),
  );

  /**
   * Gets the ARIA orientation of the resize splitter: vertical for left/right panels (it resizes
   * horizontally), horizontal for top/bottom panels.
   */
  protected readonly splitterOrientation: Signal<'horizontal' | 'vertical'> = computed(
    (): 'horizontal' | 'vertical' => (this.horizontal() ? 'vertical' : 'horizontal'),
  );

  /**
   * Begins a splitter drag, resizing the panel as the pointer moves until it is released. The drag
   * direction follows the docking edge so dragging toward the layout's centre always shrinks the
   * panel, and the result is clamped to the panel's minimum and maximum size.
   * @param event The pointer-down event that started the drag.
   */
  protected onSplitterDown(event: MouseEvent): void {
    event.preventDefault();
    const horizontal: boolean = this.horizontal();
    const grows: number = this.edge() === 'right' || this.edge() === 'bottom' ? -1 : 1;
    const start: number = horizontal ? event.clientX : event.clientY;
    const startSize: number = this.size();

    const onMove: (move: MouseEvent) => void = (move: MouseEvent): void => {
      const current: number = horizontal ? move.clientX : move.clientY;
      const delta: number = (current - start) * grows;
      const next: number = Math.min(this.maxSize(), Math.max(this.minSize(), startSize + delta));
      this.size.set(next);
    };
    const onUp: () => void = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
}
