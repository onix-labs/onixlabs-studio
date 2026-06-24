import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Icon } from '../../../../../icons/icon';
import { MarkdownToolPanel } from '../markdown-tool-panel/markdown-tool-panel';

/**
 * The Review tool panel: spelling and grammar suggestions for the document.
 *
 * Scaffold only — review is not yet built.
 */
@Component({
  selector: 'app-markdown-review-panel',
  imports: [MarkdownToolPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-markdown-tool-panel title="Review" [icon]="Icon.REVIEW">
      <p class="tool-panel-placeholder">Spelling and grammar suggestions will appear here.</p>
    </app-markdown-tool-panel>
  `,
  styles: [
    `
      .tool-panel-placeholder {
        margin: 0;
        font-size: 0.85rem;
        line-height: 1.5;
        color: var(--welcome-muted-foreground-color);
      }
    `,
  ],
})
export class MarkdownReviewPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;
}
