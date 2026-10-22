import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  InputSignal,
} from '@angular/core';
import { DockGeometry } from '../../../services/dock-layout/dock-geometry';
import { DockMinimum, DockMinimums } from '../../../services/dock-layout/dock-minimums';
import {
  DockNode as DockTreeNode,
  isStackNode,
  SplitDirection,
} from '../../../services/dock-layout/dock-node';
import { findNode } from '../../../services/dock-layout/dock-tree';
import { DockState } from '../../../services/dock-layout/dock-state';

/**
 * The least pixel size either pane on a splitter may be dragged down to, whatever its content — the
 * floor under each side's computed minimum (#1064), so a pane is never collapsed to nothing.
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
   * Holds the dock geometry, told when a drag starts and ends so measurement-driven consumers (the
   * tab strips' fill measurement) can defer their forced layouts until the gesture settles.
   */
  private readonly geometry: DockGeometry = inject(DockGeometry);

  /**
   * Holds the dock's minimum sizes, which bound each side of a drag (#1064).
   */
  private readonly minimums: DockMinimums = inject(DockMinimums);

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
  /**
   * Gets the minimum, along the drag's axis, of one of the split's children: a group's, or a nested
   * split's and everything in it. A collapsed child keeps its strip's size and is not dragged.
   * @param childIndex The child's index in the split.
   * @param horizontal Whether the drag resizes widths.
   * @returns Returns the minimum, in pixels.
   */
  private minimumAlong(childIndex: number, horizontal: boolean): number {
    const split: DockTreeNode | null = findNode(this.dockState.layout(), this.splitId());
    if (split === null || isStackNode(split)) {
      return 0;
    }
    const minimum: DockMinimum = this.minimums.minimumOf(split.children[childIndex]);
    return horizontal ? minimum.inline : minimum.block;
  }

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

    // Each side stops at its content's minimum (#1064). When the pair is already too small for both
    // — a window made smaller before the minimums held — the bounds cross, and the drag holds the
    // split where it is rather than lurching to either end.
    const minBefore: number = Math.max(MINIMUM_PANE_SIZE, this.minimumAlong(index, horizontal));
    const minAfter: number = Math.max(MINIMUM_PANE_SIZE, this.minimumAlong(index + 1, horizontal));
    const low: number = Math.min(minBefore, startBeforePx);
    const high: number = Math.max(pairPx - minAfter, startBeforePx);

    const onMove: (move: MouseEvent) => void = (move: MouseEvent): void => {
      const delta: number = (horizontal ? move.clientX : move.clientY) - start;
      const beforePx: number = Math.max(low, Math.min(startBeforePx + delta, high));
      beforeGrow = (beforePx / pairPx) * pairGrow;
      afterGrow = pairGrow - beforeGrow;
      before.style.flex = `${beforeGrow} 1 0`;
      after.style.flex = `${afterGrow} 1 0`;
    };

    const onRelease: () => void = (): void => {
      this.document.removeEventListener('mousemove', onMove);
      this.document.removeEventListener('mouseup', onRelease);
      handle.classList.remove('dock-splitter--dragging');
      this.geometry.endInteractiveResize();
      const next: number[] = [...sizes];
      next[index] = beforeGrow;
      next[index + 1] = afterGrow;
      this.dockState.setSizes(this.splitId(), next);
    };

    handle.classList.add('dock-splitter--dragging');
    this.geometry.beginInteractiveResize();
    this.document.addEventListener('mousemove', onMove);
    this.document.addEventListener('mouseup', onRelease);
  }
}
