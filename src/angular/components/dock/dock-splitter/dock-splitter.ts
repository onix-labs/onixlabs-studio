import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  InputSignal,
} from '@angular/core';
import { SplitDirection } from '../../../services/dock/dock-node';
import { DockState } from '../../../services/dock/dock-state';

/**
 * The minimum pixel size either pane on a splitter may be dragged down to, so a pane is never
 * collapsed to nothing.
 */
const MINIMUM_PANE_SIZE: number = 36;

/**
 * Represents the draggable handle between two adjacent children of a split. Dragging redistributes
 * flex-grow between the two panes live — by writing inline `flex` straight to the pane elements, so
 * no change detection runs per frame — and commits the new weights to {@link DockState} on release.
 */
@Component({
  selector: 'app-dock-splitter',
  imports: [],
  templateUrl: './dock-splitter.html',
  styleUrl: './dock-splitter.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.dock-splitter--row]': "dir() === 'row'",
    '[class.dock-splitter--col]': "dir() === 'col'",
    '[class.dock-splitter--disabled]': 'disabled()',
    '(mousedown)': 'onPress($event)',
  },
})
export class DockSplitter {
  /**
   * Holds the document used to track the drag beyond the handle's own bounds.
   */
  private readonly document: Document = inject(DOCUMENT);

  /**
   * Holds the handle element, whose siblings are the two panes it resizes.
   */
  private readonly hostElement: ElementRef<HTMLElement> = inject(
    ElementRef,
  ) as ElementRef<HTMLElement>;

  /**
   * Holds the layout state the resize commits to.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Gets the identifier of the split this handle resizes.
   */
  public readonly splitId: InputSignal<string> = input.required<string>();

  /**
   * Gets the index of the pane preceding this handle within the split.
   */
  public readonly index: InputSignal<number> = input.required<number>();

  /**
   * Gets the orientation of the split, which sets the resize axis and cursor.
   */
  public readonly dir: InputSignal<SplitDirection> = input.required<SplitDirection>();

  /**
   * Gets the current flex-grow weights of the split's children.
   */
  public readonly sizes: InputSignal<readonly number[]> = input.required<readonly number[]>();

  /**
   * Gets whether the handle is inert, used when an adjacent pane is collapsed to a fixed-size strip
   * that must not be resized. A disabled handle keeps the gap but ignores drags.
   */
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);

  /**
   * Begins a splitter drag, redistributing flex-grow between the two adjacent panes until release.
   * @param event The originating mouse event.
   */
  protected onPress(event: MouseEvent): void {
    if (this.disabled()) {
      return;
    }
    event.preventDefault();
    const handle: HTMLElement = this.hostElement.nativeElement;
    const container: HTMLElement | null = handle.parentElement;
    const before: HTMLElement | null = handle.previousElementSibling as HTMLElement | null;
    const after: HTMLElement | null = handle.nextElementSibling as HTMLElement | null;
    if (container === null || before === null || after === null) {
      return;
    }

    const horizontal: boolean = this.dir() === 'row';
    const rect: DOMRect = container.getBoundingClientRect();
    const total: number = horizontal ? rect.width : rect.height;
    const start: number = horizontal ? event.clientX : event.clientY;

    const sizes: readonly number[] = this.sizes();
    const index: number = this.index();
    const totalGrow: number = sizes.reduce((sum: number, size: number): number => sum + size, 0);
    const pairGrow: number = sizes[index] + sizes[index + 1];
    const pairPx: number = (pairGrow / totalGrow) * total;
    const startBeforePx: number = (sizes[index] / totalGrow) * total;

    let beforeGrow: number = sizes[index];
    let afterGrow: number = sizes[index + 1];

    const onMove: (move: MouseEvent) => void = (move: MouseEvent): void => {
      const delta: number = (horizontal ? move.clientX : move.clientY) - start;
      const beforePx: number = Math.max(
        MINIMUM_PANE_SIZE,
        Math.min(startBeforePx + delta, pairPx - MINIMUM_PANE_SIZE),
      );
      beforeGrow = (beforePx / pairPx) * pairGrow;
      afterGrow = pairGrow - beforeGrow;
      before.style.flex = `${beforeGrow} 1 0`;
      after.style.flex = `${afterGrow} 1 0`;
    };

    const onRelease: () => void = (): void => {
      this.document.removeEventListener('mousemove', onMove);
      this.document.removeEventListener('mouseup', onRelease);
      handle.classList.remove('dock-splitter--dragging');
      const next: number[] = [...sizes];
      next[index] = beforeGrow;
      next[index + 1] = afterGrow;
      this.dockState.setSizes(this.splitId(), next);
    };

    handle.classList.add('dock-splitter--dragging');
    this.document.addEventListener('mousemove', onMove);
    this.document.addEventListener('mouseup', onRelease);
  }
}
