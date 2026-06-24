import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Icon } from '../../../../../icons/icon';
import { MarkdownToolPanel } from '../markdown-tool-panel/markdown-tool-panel';

/**
 * The Reader tool panel: reads the document aloud using the browser Speech Synthesis API, with a
 * karaoke-style follow-along mode that selects the word currently being spoken.
 *
 * Scaffold only — the reader is not yet built.
 */
@Component({
  selector: 'app-markdown-reader-panel',
  imports: [MarkdownToolPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-markdown-tool-panel title="Reader" [icon]="Icon.READER">
      <p class="tool-panel-placeholder">
        Read-aloud controls with karaoke-style follow-along will appear here.
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
export class MarkdownReaderPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;
}
