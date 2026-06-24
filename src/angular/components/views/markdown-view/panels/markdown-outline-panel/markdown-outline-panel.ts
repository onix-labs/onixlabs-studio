import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Icon } from '../../../../../icons/icon';
import { MarkdownToolPanel } from '../markdown-tool-panel/markdown-tool-panel';

/**
 * The Outline tool panel: a navigable outline of the document's headings and subheadings (including
 * setext headings).
 *
 * Scaffold only — the outline is not yet built.
 */
@Component({
  selector: 'app-markdown-outline-panel',
  imports: [MarkdownToolPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-markdown-tool-panel title="Outline" [icon]="Icon.OUTLINE">
      <p class="tool-panel-placeholder">
        The document outline (headings and subheadings, including setext headings) will appear here.
      </p>
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
export class MarkdownOutlinePanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;
}
