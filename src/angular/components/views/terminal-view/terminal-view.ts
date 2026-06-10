import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';

/**
 * Represents the terminal view. This is a placeholder pending the xterm terminal implementation.
 */
@Component({
  selector: 'app-terminal-view',
  imports: [],
  templateUrl: './terminal-view.html',
  styleUrl: './terminal-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalView {
  /**
   * Gets a value indicating whether the view belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);
}
