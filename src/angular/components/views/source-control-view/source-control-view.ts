import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { Icon } from '../../../icons/icon';
import { AppIcon } from '../../shared/icon/app-icon';

/**
 * Hosts the source-control workspace as a top-level tab — a visual Git surface (branches, history,
 * staging) in the spirit of GitKraken. The full view is still to come; for now this is a placeholder
 * so the tab type, its icon, and the welcome-screen entry point are wired end to end.
 */
@Component({
  selector: 'app-source-control-view',
  imports: [AppIcon],
  templateUrl: './source-control-view.html',
  styleUrl: './source-control-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceControlView {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets a value indicating whether the view belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);
}
