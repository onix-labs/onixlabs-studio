import { CdkDrag, CdkDragPreview, DragConstrainPosition } from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { Tab } from '../../../../services/tabs/tab';

/**
 * Represents a single tab in the title strip.
 */
@Component({
  selector: 'app-title-strip-tab',
  imports: [CdkDrag, CdkDragPreview],
  templateUrl: './title-strip-tab.html',
  styleUrl: './title-strip-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TitleStripTab {
  /**
   * Gets the tab to render.
   */
  public readonly tab: InputSignal<Tab> = input.required<Tab>();

  /**
   * Gets a value indicating whether the tab is the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emits when the user selects the tab.
   */
  public readonly selectTab: OutputEmitterRef<void> = output<void>();

  /**
   * Emits when the user requests to close the tab.
   */
  public readonly closeTab: OutputEmitterRef<void> = output<void>();

  /**
   * Pins the drag preview to the tab rail so it slides horizontally without translating vertically.
   *
   * A custom `cdkDragPreview` makes the CDK anchor the preview's top-left to the cursor, which would
   * otherwise leave the chip floating over the rail by however far down the tab was grabbed. The
   * horizontal position tracks the pointer, while the vertical position is locked to the tab's
   * original top edge so its bottom keeps meeting the rail.
   * @param point The current pointer position.
   * @param _dragRef The drag reference (unused).
   * @param dimensions The originating tab's bounding rectangle, captured at drag start.
   * @returns The constrained top-left position for the drag preview.
   */
  protected readonly anchorDragToRail: DragConstrainPosition = (point, _dragRef, dimensions) => ({
    x: point.x,
    y: dimensions.top,
  });

  /**
   * Handles a click on the close button, suppressing the tab-selection click.
   * @param event The originating pointer event.
   */
  protected onCloseClick(event: MouseEvent): void {
    event.stopPropagation();
    this.closeTab.emit();
  }
}
