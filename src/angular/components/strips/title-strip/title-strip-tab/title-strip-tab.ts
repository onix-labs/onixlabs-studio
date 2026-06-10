import { CdkDrag } from '@angular/cdk/drag-drop';
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
  imports: [CdkDrag],
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
   * Handles a click on the close button, suppressing the tab-selection click.
   * @param event The originating pointer event.
   */
  protected onCloseClick(event: MouseEvent): void {
    event.stopPropagation();
    this.closeTab.emit();
  }
}
