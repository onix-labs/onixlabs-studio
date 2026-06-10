import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { DockContainer } from '../../dock/dock-container/dock-container';

/**
 * Represents the directory (IDE) view, which hosts the dockable panel layout.
 */
@Component({
  selector: 'app-directory-view',
  imports: [DockContainer],
  templateUrl: './directory-view.html',
  styleUrl: './directory-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DirectoryView {
  /**
   * Gets a value indicating whether the view belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);
}
