import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import { SPLIT_CONTEXT, SPLIT_PART, SplitContext } from '../split-context';
import { SplitDirection } from '../split-direction';
import type { SplitDivider } from '../split-divider/split-divider';
import { SplitPane } from '../split-pane/split-pane';

/**
 * Specifies how a split draws its dividers: `gap` gives each a gap of its own between its panes, and
 * `overlay` draws it over the inner edge of the pane it sizes, unseen until hovered.
 */
export type SplitDividers = 'gap' | 'overlay';

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
 * Panes sized by share hold no state: dragging a divider between two of them sizes them live and reports
 * every pane's share on release, and the host gives them back through the panes' inputs. A pane sized in
 * pixels keeps its own size, and remembers it under {@link sizesKey} when there is one.
 */
@Component({
  selector: 'app-split-panel',
  templateUrl: './split-panel.html',
  styleUrl: './split-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: SPLIT_CONTEXT, useExisting: SplitPanel }],
  host: {
    '[class.split-panel--row]': "dir() === 'row'",
    '[class.split-panel--col]': "dir() === 'col'",
  },
})
export class SplitPanel implements SplitContext {
  /**
   * Gets the orientation in which the panes are laid out.
   */
  public readonly dir: InputSignal<SplitDirection> = input.required<SplitDirection>();

  /**
   * Gets how the dividers are drawn: in a gap of their own between the panes, or over the edge of the
   * pane they size, taking no room.
   */
  public readonly dividers: InputSignal<SplitDividers> = input<SplitDividers>('gap');

  /**
   * Gets the key the panes' pixel sizes are remembered under, shared by every split of one kind: a new
   * split starts at the sizes last set under its key, and the ones already open keep their own. Null
   * remembers nothing.
   */
  public readonly sizesKey: InputSignal<string | null> = input<string | null>(null);

  /**
   * Emits every pane's share, in order, when a divider between two panes sized by share is released.
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
   * Gets the split's panes and dividers, in order.
   */
  public readonly parts: Signal<readonly (SplitPane | SplitDivider)[]> =
    contentChildren(SPLIT_PART);

  /**
   * Gets the split's panes, in order.
   */
  public readonly panes: Signal<readonly SplitPane[]> = computed((): readonly SplitPane[] =>
    this.parts().filter(
      (part: SplitPane | SplitDivider): part is SplitPane => part instanceof SplitPane,
    ),
  );
}
