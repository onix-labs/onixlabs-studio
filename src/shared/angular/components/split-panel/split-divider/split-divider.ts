import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  OnDestroy,
  Signal,
} from '@angular/core';
import { SPLIT_PART } from '../split-context';
import { SplitPane } from '../split-pane/split-pane';
import { SplitPanel } from '../split-panel/split-panel';

/**
 * The least pixel size either pane beside a divider may be dragged down to, whatever its content — the
 * floor under each pane's own minimum (#1064), so a pane is never collapsed to nothing.
 */
const MINIMUM_PANE_SIZE: number = 36;

/**
 * The two panes a divider divides.
 */
interface SplitNeighbours {
  /**
   * Gets the pane before the divider.
   */
  readonly before: SplitPane;

  /**
   * Gets the pane after the divider.
   */
  readonly after: SplitPane;
}

/**
 * Represents the draggable handle between two panes of a {@link SplitPanel}: the nearest shown pane
 * either side of it. Dragging resizes the pair live — by writing inline `flex` straight to the pane
 * elements, so no change detection runs per frame — and settles on release.
 *
 * Between two panes sized by share, the drag moves room from one's share to the other's. A pane sized in
 * pixels changes size instead, and gives to or takes from the panes sized by share.
 */
@Component({
  selector: 'app-split-divider',
  templateUrl: './split-divider.html',
  styleUrl: './split-divider.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: SPLIT_PART, useExisting: SplitDivider }],
  host: {
    role: 'separator',
    '[attr.aria-orientation]': "split.dir() === 'row' ? 'vertical' : 'horizontal'",
    '[class.split-divider--row]': "split.dir() === 'row'",
    '[class.split-divider--col]': "split.dir() === 'col'",
    '[class.split-divider--disabled]': 'inert()',
    '[class.split-divider--hidden]': 'neighbours() === null',
    '(mousedown)': 'onPress($event)',
  },
})
export class SplitDivider implements OnDestroy {
  /**
   * Holds the document used to track the drag beyond the handle's own bounds.
   */
  private readonly document: Document = inject(DOCUMENT);

  /**
   * Holds the handle element.
   */
  private readonly hostElement: ElementRef<HTMLElement> =
    inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Holds the split the handle belongs to.
   */
  protected readonly split: SplitPanel = inject(SplitPanel);

  /**
   * Gets the panes the handle divides, or null when there is nothing for it to divide: a hidden pane
   * leaves no shown pane on one side, or another divider already serves the same pair.
   */
  protected readonly neighbours: Signal<SplitNeighbours | null> = computed(
    (): SplitNeighbours | null => {
      const parts: readonly (SplitPane | SplitDivider)[] = this.split.parts();
      const index: number = parts.indexOf(this);
      let before: SplitPane | null = null;
      for (let at: number = index - 1; at >= 0 && before === null; at -= 1) {
        const part: SplitPane | SplitDivider = parts[at];
        if (part instanceof SplitDivider) {
          return null;
        }
        before = part.visible() ? part : null;
      }
      const after: SplitPane | undefined = parts
        .slice(index + 1)
        .find(
          (part: SplitPane | SplitDivider): part is SplitPane =>
            part instanceof SplitPane && part.visible(),
        );
      return before === null || after === undefined ? null : { before, after };
    },
  );

  /**
   * Gets whether the handle ignores drags, beside a pane that is not to be resized. It keeps its gap.
   */
  protected readonly inert: Signal<boolean> = computed((): boolean => {
    const neighbours: SplitNeighbours | null = this.neighbours();
    return neighbours === null || !neighbours.before.resizable() || !neighbours.after.resizable();
  });

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
   * Begins a drag, resizing the two panes until release.
   * @param event The originating mouse event.
   */
  protected onPress(event: MouseEvent): void {
    const handle: HTMLElement = this.hostElement.nativeElement;
    const container: HTMLElement | null = handle.parentElement;
    const neighbours: SplitNeighbours | null = this.neighbours();
    if (this.inert() || neighbours === null || container === null) {
      return;
    }
    event.preventDefault();
    // A second press before the first is released (another button) starts afresh.
    this.abandon?.();
    const { before, after }: SplitNeighbours = neighbours;
    const horizontal: boolean = this.split.dir() === 'row';
    const lengthOf: (element: HTMLElement) => number = (element: HTMLElement): number => {
      const rect: DOMRect = element.getBoundingClientRect();
      return horizontal ? rect.width : rect.height;
    };
    const start: number = horizontal ? event.clientX : event.clientY;

    // Two panes sized by share trade room in shares: the split's room, less what panes sized in pixels
    // take of it. Otherwise the pair is measured as it stands.
    const panes: readonly SplitPane[] = this.split.panes();
    const shown: readonly SplitPane[] = panes.filter((pane: SplitPane): boolean => pane.visible());
    const byShare: boolean = !before.sized() && !after.sized();
    const sharing: readonly SplitPane[] = shown.filter((pane: SplitPane): boolean => !pane.sized());
    const room: number = shown
      .filter((pane: SplitPane): boolean => pane.sized())
      .reduce(
        (left: number, pane: SplitPane): number => left - lengthOf(pane.element),
        lengthOf(container),
      );
    const totalShare: number = sharing.reduce(
      (sum: number, pane: SplitPane): number => sum + pane.share(),
      0,
    );
    const pairShare: number = before.share() + after.share();
    const startBeforePx: number = byShare
      ? (before.share() / totalShare) * room
      : lengthOf(before.element);
    const pairPx: number = byShare
      ? (pairShare / totalShare) * room
      : startBeforePx + lengthOf(after.element);

    let beforePx: number = startBeforePx;
    let beforeShare: number = before.share();

    // Each side stops at its content's minimum (#1064) and its own maximum. When the pair is already
    // too small for both — a window made smaller before the minimums held — the bounds cross, and the
    // drag holds the split where it is rather than lurching to either end.
    const minBefore: number = Math.max(MINIMUM_PANE_SIZE, before.minSize());
    const minAfter: number = Math.max(MINIMUM_PANE_SIZE, after.minSize());
    const low: number = Math.min(Math.max(minBefore, pairPx - after.limit()), startBeforePx);
    const high: number = Math.max(Math.min(pairPx - minAfter, before.limit()), startBeforePx);

    const onMove: (move: MouseEvent) => void = (move: MouseEvent): void => {
      const delta: number = (horizontal ? move.clientX : move.clientY) - start;
      beforePx = Math.max(low, Math.min(startBeforePx + delta, high));
      if (byShare) {
        beforeShare = (beforePx / pairPx) * pairShare;
        before.previewShare(beforeShare);
        after.previewShare(pairShare - beforeShare);
        return;
      }
      if (before.sized()) {
        before.previewSize(beforePx);
      }
      if (after.sized()) {
        after.previewSize(pairPx - beforePx);
      }
    };

    const finish: () => void = (): void => {
      this.abandon = null;
      this.document.removeEventListener('mousemove', onMove);
      this.document.removeEventListener('mouseup', onRelease);
      handle.classList.remove('split-divider--dragging');
      this.split.resizeEnd.emit();
    };

    const onRelease: () => void = (): void => {
      // The split was rearranged under the pointer, so what was dragged may no longer be there.
      const current: SplitNeighbours | null = this.neighbours();
      if (
        this.split.panes().length !== panes.length ||
        current?.before !== before ||
        current.after !== after
      ) {
        this.abandon?.();
        return;
      }
      finish();
      if (byShare) {
        this.split.sharesChange.emit(
          panes.map((pane: SplitPane): number => {
            if (pane === before) {
              return beforeShare;
            }
            return pane === after ? pairShare - beforeShare : pane.share();
          }),
        );
        return;
      }
      // A press that went nowhere sets nothing, so a size held back by the window is not lost to it.
      if (beforePx === startBeforePx) {
        before.clearPreview();
        after.clearPreview();
        return;
      }
      if (before.sized()) {
        before.commitSize(beforePx);
      }
      if (after.sized()) {
        after.commitSize(pairPx - beforePx);
      }
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
