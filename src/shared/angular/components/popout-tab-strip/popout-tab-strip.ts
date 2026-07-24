import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';

/**
 * The tab strip of a pop-out window hosting more than one panel: one tab per panel, switching which
 * is visible, with a per-tab affordance returning that panel to the dock. Rendered by the pop-out
 * coordinator into the window's chrome (between the title bar and the content), so a panel dragged
 * into an occupied window joins it as a tab rather than replacing it.
 */
@Component({
  selector: 'app-popout-tab-strip',
  imports: [AppIcon, PanelToolbar],
  templateUrl: './popout-tab-strip.html',
  styleUrl: './popout-tab-strip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PopoutTabStrip {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the panels hosted by the window, in tab order.
   */
  public readonly panels: InputSignal<readonly DockPanel[]> = input.required<readonly DockPanel[]>();

  /**
   * Gets the identifier of the visible panel, or null when the window is empty.
   */
  public readonly activeId: InputSignal<string | null> = input.required<string | null>();

  /**
   * Emits the identifier of a tab the user activated.
   */
  public readonly activated: OutputEmitterRef<string> = output<string>();

  /**
   * Emits the identifier of a panel the user sent back to the dock.
   */
  public readonly dockedBack: OutputEmitterRef<string> = output<string>();

  /**
   * Sends a panel back to the dock without activating its tab first.
   * @param panelId The panel identifier.
   * @param event The originating click, whose propagation to the tab is stopped.
   */
  protected dockBack(panelId: string, event: Event): void {
    event.stopPropagation();
    this.dockedBack.emit(panelId);
  }
}
