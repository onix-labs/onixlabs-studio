import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  InputSignal,
  OnDestroy,
} from '@angular/core';
import { SplitPane } from '../split-pane/split-pane';
import { SplitPanel } from '../split-panel/split-panel';

/**
 * The least pixel size either pane beside a divider may be dragged down to, whatever its content — the
 * floor under each pane's own minimum (#1064), so a pane is never collapsed to nothing.
 */
const MINIMUM_PANE_SIZE: number = 36;

/**
 * Represents the draggable handle between two adjacent panes of a {@link SplitPanel}. Dragging
 * redistributes the pair's shares live — by writing inline `flex` straight to the pane elements, so no
 * change detection runs per frame — and has the split report the new shares on release.
 */
@Component({
  selector: 'app-split-divider',
  templateUrl: './split-divider.html',
  styleUrl: './split-divider.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'separator',
    '[attr.aria-orientation]': "split.dir() === 'row' ? 'vertical' : 'horizontal'",
    '[class.split-divider--row]': "split.dir() === 'row'",
    '[class.split-divider--col]': "split.dir() === 'col'",
    '[class.split-divider--disabled]': 'locked()',
    '(mousedown)': 'onPress($event)',
  },
})
export class SplitDivider implements OnDestroy {
  /**
   * Holds the document used to track the drag beyond the handle's own bounds.
   */
  private readonly document: Document = inject(DOCUMENT);

  /**
   * Holds the handle element, whose siblings are the two panes it resizes.
   */
  private readonly hostElement: ElementRef<HTMLElement> =
    inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Holds the split the handle belongs to.
   */
  protected readonly split: SplitPanel = inject(SplitPanel);

  /**
   * Gets whether the handle is inert, used when an adjacent pane keeps a size that must not be
   * dragged. A locked handle keeps the gap but ignores drags.
   */
  public readonly locked: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds the function that abandons the drag in progress, or null when none is.
   */
  private abandon: (() => void) | null = null;

  /**
   * Abandons a drag in progress, since a divider that goes away hears no release.
   */
  public ngOnDestroy(): void {
    this.abandon?.();
  }

  /**
   * Begins a drag, redistributing the two adjacent panes' shares until release.
   * @param event The originating mouse event.
   */
  protected onPress(event: MouseEvent): void {
    if (this.locked()) {
      return;
    }
    event.preventDefault();
    // A second press before the first is released (another button) starts afresh.
    this.abandon?.();
    const handle: HTMLElement = this.hostElement.nativeElement;
    const container: HTMLElement | null = handle.parentElement;
    const panes: readonly SplitPane[] = this.split.panes();
    const index: number = panes.findIndex(
      (pane: SplitPane): boolean => pane.element === handle.previousElementSibling,
    );
    const before: SplitPane | undefined = panes[index];
    const after: SplitPane | undefined = panes[index + 1];
    if (container === null || before === undefined || after === undefined) {
      return;
    }

    const horizontal: boolean = this.split.dir() === 'row';
    const rect: DOMRect = container.getBoundingClientRect();
    const total: number = horizontal ? rect.width : rect.height;
    const start: number = horizontal ? event.clientX : event.clientY;

    const shares: readonly number[] = panes.map((pane: SplitPane): number => pane.share());
    const totalShare: number = shares.reduce(
      (sum: number, share: number): number => sum + share,
      0,
    );
    const pairShare: number = shares[index] + shares[index + 1];
    const pairPx: number = (pairShare / totalShare) * total;
    const startBeforePx: number = (shares[index] / totalShare) * total;

    let beforeShare: number = shares[index];
    let afterShare: number = shares[index + 1];

    // Each side stops at its content's minimum (#1064). When the pair is already too small for both
    // — a window made smaller before the minimums held — the bounds cross, and the drag holds the
    // split where it is rather than lurching to either end.
    const minBefore: number = Math.max(MINIMUM_PANE_SIZE, before.minSize());
    const minAfter: number = Math.max(MINIMUM_PANE_SIZE, after.minSize());
    const low: number = Math.min(minBefore, startBeforePx);
    const high: number = Math.max(pairPx - minAfter, startBeforePx);

    const onMove: (move: MouseEvent) => void = (move: MouseEvent): void => {
      const delta: number = (horizontal ? move.clientX : move.clientY) - start;
      const beforePx: number = Math.max(low, Math.min(startBeforePx + delta, high));
      beforeShare = (beforePx / pairPx) * pairShare;
      afterShare = pairShare - beforeShare;
      before.previewShare(beforeShare);
      after.previewShare(afterShare);
    };

    const finish: () => void = (): void => {
      this.abandon = null;
      this.document.removeEventListener('mousemove', onMove);
      this.document.removeEventListener('mouseup', onRelease);
      handle.classList.remove('split-divider--dragging');
      this.split.resizeEnd.emit();
    };

    const onRelease: () => void = (): void => {
      // The split was rearranged under the pointer, so these shares belong to panes that have gone.
      const current: readonly SplitPane[] = this.split.panes();
      if (
        current.length !== panes.length ||
        current[index] !== before ||
        current[index + 1] !== after
      ) {
        this.abandon?.();
        return;
      }
      finish();
      const next: number[] = [...shares];
      next[index] = beforeShare;
      next[index + 1] = afterShare;
      this.split.sharesChange.emit(next);
    };

    this.abandon = (): void => {
      before.clearPreview();
      after.clearPreview();
      finish();
    };
    handle.classList.add('split-divider--dragging');
    this.split.resizeStart.emit();
    this.document.addEventListener('mousemove', onMove);
    this.document.addEventListener('mouseup', onRelease);
  }
}
