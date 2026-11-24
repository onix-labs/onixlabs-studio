import {
  ChangeDetectionStrategy,
  Component,
  contentChildren,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import { SplitDirection } from '../split-direction';
import { SplitPane } from '../split-pane/split-pane';

/**
 * Represents a split: a row or column of {@link SplitPane}s, with a
 * {@link import('../split-divider/split-divider').SplitDivider} placed between each pair the user may
 * resize. The panes and dividers are the host's own content, in order:
 *
 * ```html
 * <app-split-panel dir="col" (sharesChange)="onShares($event)">
 *   <app-split-pane [share]="shares()[0]">…</app-split-pane>
 *   <app-split-divider />
 *   <app-split-pane [share]="shares()[1]">…</app-split-pane>
 * </app-split-panel>
 * ```
 *
 * The split holds no sizes of its own. Dragging a divider sizes its two panes live and reports every
 * pane's share on release, and the host gives them back through the panes' inputs.
 */
@Component({
  selector: 'app-split-panel',
  templateUrl: './split-panel.html',
  styleUrl: './split-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.split-panel--row]': "dir() === 'row'",
    '[class.split-panel--col]': "dir() === 'col'",
  },
})
export class SplitPanel {
  /**
   * Gets the orientation in which the panes are laid out.
   */
  public readonly dir: InputSignal<SplitDirection> = input.required<SplitDirection>();

  /**
   * Emits every pane's share, in order, when a divider is released.
   */
  public readonly sharesChange: OutputEmitterRef<readonly number[]> = output<readonly number[]>();

  /**
   * Emits when a divider starts to be dragged.
   */
  public readonly resizeStart: OutputEmitterRef<void> = output<void>();

  /**
   * Emits when a divider's drag ends, always once for each start: before {@link sharesChange} when it
   * was released, and alone when the divider went away under the pointer.
   */
  public readonly resizeEnd: OutputEmitterRef<void> = output<void>();

  /**
   * Gets the split's panes, in order.
   */
  public readonly panes: Signal<readonly SplitPane[]> = contentChildren<SplitPane>(SplitPane);
}
