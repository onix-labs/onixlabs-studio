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

/**
 * Represents one pane of a split: a cell that takes its {@link share} of the split's room, or a
 * {@link fixedSize} of its own. A pane draws nothing but its content, so its host gives it whatever
 * surface it wants.
 */
@Component({
  selector: 'app-split-pane',
  templateUrl: './split-pane.html',
  styleUrl: './split-pane.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.flex]': 'flex()',
  },
})
export class SplitPane {
  /**
   * Holds the pane's element, which a drag sizes directly.
   */
  private readonly hostElement: ElementRef<HTMLElement> =
    inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Gets the pane's weight: its part of the split's room is its share divided by every pane's.
   */
  public readonly share: InputSignal<number> = input<number>(1);

  /**
   * Gets the least size, in pixels, a divider may drag the pane down to, along the split's axis.
   */
  public readonly minSize: InputSignal<number> = input<number>(0);

  /**
   * Gets the CSS length the pane keeps along the split's axis whatever its share, or null when its
   * share sizes it. The share is kept meanwhile, so the pane returns to it. A divider beside a fixed
   * pane is the host's to lock.
   */
  public readonly fixedSize: InputSignal<string | null> = input<string | null>(null);

  /**
   * Gets the flex shorthand that sizes the pane.
   */
  protected readonly flex: Signal<string> = computed((): string => {
    const fixed: string | null = this.fixedSize();
    return fixed === null ? `${this.share()} 1 0` : `0 0 ${fixed}`;
  });

  /**
   * Gets the pane's element, which a divider finds its neighbours by.
   */
  public get element(): HTMLElement {
    return this.hostElement.nativeElement;
  }

  /**
   * Sizes the pane to a share while a divider is dragged, writing straight to the element so no change
   * detection runs per frame.
   * @param share The share to show.
   */
  public previewShare(share: number): void {
    this.element.style.flex = `${share} 1 0`;
  }

  /**
   * Returns the pane to the size its inputs give it, after a drag that came to nothing.
   */
  public clearPreview(): void {
    this.element.style.flex = this.flex();
  }
}
