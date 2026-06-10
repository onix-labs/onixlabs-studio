import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';

/**
 * Represents the directory (IDE) view. This is a placeholder pending the dockable IDE implementation.
 */
@Component({
  selector: 'app-directory-view',
  imports: [],
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
