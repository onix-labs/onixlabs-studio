import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';

/**
 * Represents the markdown view. This is a placeholder pending the Milkdown editor implementation.
 */
@Component({
  selector: 'app-markdown-view',
  imports: [],
  templateUrl: './markdown-view.html',
  styleUrl: './markdown-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownView {
  /**
   * Gets a value indicating whether the view belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);
}
