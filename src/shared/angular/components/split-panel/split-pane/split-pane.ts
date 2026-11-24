import { DOCUMENT } from '@angular/common';
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
  linkedSignal,
  output,
  OutputEmitterRef,
  Signal,
  WritableSignal,
} from '@angular/core';
import { SPLIT_CONTEXT, SPLIT_PART, SplitContext } from '../split-context';
import { SplitSizes } from '../split-sizes';

/**
 * Represents one pane of a split. A pane is sized in one of two ways:
 *
 * - **by its {@link share}** of the room the split has, growing and shrinking with it; or
 * - **in pixels**, when it is given a {@link defaultSize}, a {@link defaultFraction} or a
 *   {@link hostSize}: it keeps its size as the split resizes, within its limits, and the panes sized by share take up the difference.
 *
 * A pane draws nothing but its content, so its host gives it whatever surface it wants.
 */
@Component({
  selector: 'app-split-pane',
  templateUrl: './split-pane.html',
  styleUrl: './split-pane.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: SPLIT_PART, useExisting: SplitPane }],
  host: {
    '[class.split-pane--hidden]': '!visible()',
    '[style.flex]': 'flex()',
    '[style.min-inline-size.px]': 'row() ? minimum() : null',
    '[style.min-block-size.px]': 'row() ? null : minimum()',
    '[style.max-inline-size]': 'row() ? maximum() : null',
    '[style.max-block-size]': 'row() ? null : maximum()',
  },
})
export class SplitPane {
  /**
   * Holds the pane's element, which a drag sizes directly.
   */
  private readonly hostElement: ElementRef<HTMLElement> =
    inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Holds the document, whose window bounds a pane sized in pixels.
   */
  private readonly document: Document = inject(DOCUMENT);

  /**
   * Holds the split the pane is in, or null when it stands alone.
   */
  private readonly context: SplitContext | null = inject(SPLIT_CONTEXT, { optional: true });

  /**
   * Holds the remembered sizes.
   */
  private readonly sizes: SplitSizes = inject(SplitSizes);

  /**
   * Gets the pane's weight: its part of the room the split has for panes sized by share is its share
   * divided by all of theirs.
   */
  public readonly share: InputSignal<number> = input<number>(1);

  /**
   * Gets the id the pane's size is remembered under, within its split's key. Null forgets it.
   */
  public readonly paneId: InputSignal<string | null> = input<string | null>(null);

  /**
   * Gets the size, in pixels, the pane opens at when none is remembered. Only the first one given
   * counts, so a host may work it out late, and a later change never moves a pane that has opened.
   */
  public readonly defaultSize: InputSignal<number | null> = input<number | null>(null);

  /**
   * Gets the fraction of the split, from 0 to 1, the pane opens at when no size is remembered or given.
   * It is turned into pixels the first time the pane has room, and kept from then on.
   */
  public readonly defaultFraction: InputSignal<number | null> = input<number | null>(null);

  /**
   * Gets the size, in pixels, the host keeps for the pane, or null when the pane keeps its own or takes a
   * share. A divider that sizes it reports the new size through {@link sizeChange} and changes nothing
   * here, so the host gives it back.
   */
  public readonly hostSize: InputSignal<number | null> = input<number | null>(null);

  /**
   * Gets the least size, in pixels, the pane may be given along the split's axis, by a divider or by
   * the room there is.
   */
  public readonly minSize: InputSignal<number> = input<number>(0);

  /**
   * Gets the greatest size, in pixels, a pane sized in pixels may be given. It never exceeds half the
   * window either way, so the rest of the split keeps its place. The minimum wins where they conflict.
   */
  public readonly maxSize: InputSignal<number> = input<number>(Number.POSITIVE_INFINITY);

  /**
   * Gets whether the pane is shown. A hidden pane takes no room and neither does a divider it leaves
   * with nothing to divide, but its content stays mounted.
   */
  public readonly visible: InputSignal<boolean> = input<boolean>(true);

  /**
   * Gets whether the dividers beside the pane may resize it.
   */
  public readonly resizable: InputSignal<boolean> = input<boolean>(true);

  /**
   * Gets the CSS length the pane is locked to along the split's axis, whatever its share or size, or
   * null when it is not. Both are kept meanwhile, so the pane returns to them. A divider beside a
   * locked pane is the host's to lock.
   */
  public readonly lockedSize: InputSignal<string | null> = input<string | null>(null);

  /**
   * Emits the pane's new size, in pixels, when a divider that sized it is released.
   */
  public readonly sizeChange: OutputEmitterRef<number> = output<number>();

  /**
   * Holds the pane's size in pixels, or null while its share sizes it. The remembered size comes first,
   * then the default, and once there is one it stays until a divider sets another.
   */
  private readonly opened: WritableSignal<number | null> = linkedSignal<
    number | null,
    number | null
  >({
    source: this.defaultSize,
    computation: (
      size: number | null,
      previous?: { readonly value: number | null },
    ): number | null => previous?.value ?? this.remembered() ?? size,
  });

  /**
   * Gets the pane's size in pixels, or null while its share sizes it.
   */
  public readonly size: Signal<number | null> = computed(
    (): number | null => this.hostSize() ?? this.opened(),
  );

  /**
   * Gets whether the pane keeps a size of its own rather than taking a share.
   */
  public readonly sized: Signal<boolean> = computed(
    (): boolean => this.size() !== null || this.defaultFraction() !== null,
  );

  /**
   * Gets whether the split lays its panes out side by side.
   */
  protected readonly row: Signal<boolean> = computed((): boolean => this.context?.dir() !== 'col');

  /**
   * Gets the minimum the pane carries, so the room there is cannot crush it, or null for none.
   */
  protected readonly minimum: Signal<number | null> = computed((): number | null =>
    this.minSize() > 0 ? this.minSize() : null,
  );

  /**
   * Gets the maximum the pane carries, so a size that outgrows a later, smaller window still renders
   * bounded, or null for one sized by share.
   */
  protected readonly maximum: Signal<string | null> = computed((): string | null => {
    if (!this.sized()) {
      return null;
    }
    const half: string = this.row() ? '50vw' : '50vh';
    return Number.isFinite(this.maxSize()) ? `min(${this.maxSize()}px, ${half})` : half;
  });

  /**
   * Gets the flex shorthand that sizes the pane.
   */
  protected readonly flex: Signal<string> = computed((): string => {
    const locked: string | null = this.lockedSize();
    if (locked !== null) {
      return `0 0 ${locked}`;
    }
    const size: number | null = this.size();
    if (size !== null) {
      return sizeFlex(size);
    }
    const fraction: number | null = this.defaultFraction();
    return fraction !== null ? `0 1 ${fraction * 100}%` : shareFlex(this.share());
  });

  public constructor() {
    const destroyRef: DestroyRef = inject(DestroyRef);
    afterNextRender((): void => {
      if (this.size() !== null || this.defaultFraction() === null) {
        return;
      }
      if (typeof ResizeObserver === 'undefined') {
        this.openAtFraction();
        return;
      }
      // A pane in a tab that is not in front has no room yet, so this waits until it has.
      const observer: ResizeObserver = new ResizeObserver((): void => {
        if (this.openAtFraction()) {
          observer.disconnect();
        }
      });
      observer.observe(this.element);
      destroyRef.onDestroy((): void => observer.disconnect());
    });
  }

  /**
   * Gets the pane's element, which a divider measures.
   */
  public get element(): HTMLElement {
    return this.hostElement.nativeElement;
  }

  /**
   * Gets the greatest size, in pixels, a divider may drag the pane to: unbounded for one sized by
   * share, which takes what the others leave.
   * @returns Returns the limit.
   */
  public limit(): number {
    if (!this.sized()) {
      return Number.POSITIVE_INFINITY;
    }
    const window: Window | null = this.document.defaultView;
    const along: number =
      window === null
        ? Number.POSITIVE_INFINITY
        : this.row()
          ? window.innerWidth
          : window.innerHeight;
    return Math.min(this.maxSize(), along / 2);
  }

  /**
   * Shows a share while a divider is dragged, writing straight to the element so no change detection
   * runs per frame.
   * @param share The share to show.
   */
  public previewShare(share: number): void {
    this.element.style.flex = shareFlex(share);
  }

  /**
   * Shows a size while a divider is dragged, as {@link previewShare} does a share.
   * @param size The size to show, in pixels.
   */
  public previewSize(size: number): void {
    this.element.style.flex = sizeFlex(size);
  }

  /**
   * Returns the pane to the size its inputs give it, after a drag that came to nothing.
   */
  public clearPreview(): void {
    this.element.style.flex = this.flex();
  }

  /**
   * Sets the pane's size when a divider is released, and remembers it.
   * @param size The size in pixels.
   */
  public commitSize(size: number): void {
    const rounded: number = Math.round(size);
    if (this.hostSize() !== null) {
      // The host may give back the size already bound, which would leave the preview's fraction behind.
      this.clearPreview();
      this.sizeChange.emit(rounded);
      return;
    }
    this.opened.set(rounded);
    // The bound value may be the one already there, which would leave the preview's fraction behind.
    this.clearPreview();
    const key: string | null = this.context?.sizesKey() ?? null;
    const paneId: string | null = this.paneId();
    if (key !== null && paneId !== null) {
      this.sizes.set(key, paneId, rounded);
    }
    this.sizeChange.emit(rounded);
  }

  /**
   * Gets the size remembered for the pane.
   * @returns Returns the size in pixels, or null when none is.
   */
  private remembered(): number | null {
    const key: string | null = this.context?.sizesKey() ?? null;
    const paneId: string | null = this.paneId();
    return key === null || paneId === null ? null : this.sizes.get(key, paneId);
  }

  /**
   * Turns the pane's default fraction into pixels, once the split has room to take it of.
   * @returns Returns true when there is nothing left to wait for.
   */
  private openAtFraction(): boolean {
    const fraction: number | null = this.defaultFraction();
    if (this.size() !== null || fraction === null) {
      return true;
    }
    const rect: DOMRect | undefined = this.element.parentElement?.getBoundingClientRect();
    const length: number = (this.row() ? rect?.width : rect?.height) ?? 0;
    if (length === 0 || !this.visible()) {
      return false;
    }
    this.opened.set(Math.max(this.minSize(), Math.round(length * fraction)));
    return true;
  }
}

/**
 * Builds the flex shorthand that sizes a pane by its share.
 * @param share The share.
 * @returns Returns the shorthand.
 */
function shareFlex(share: number): string {
  return `${share} 1 0`;
}

/**
 * Builds the flex shorthand that sizes a pane in pixels, giving way when the split is too small for it.
 * @param size The size in pixels.
 * @returns Returns the shorthand.
 */
function sizeFlex(size: number): string {
  return `0 1 ${size}px`;
}
