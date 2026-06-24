import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Icon } from '../../../../../icons/icon';
import { MarkdownToolPanel } from '../markdown-tool-panel/markdown-tool-panel';

/**
 * The Agent tool panel: an AI agent session that can read the current document.
 *
 * Scaffold only. The implementation will host the existing `app-agent-chat` here (which provides its
 * own per-instance agent session) and give the agent access to the document content.
 */
@Component({
  selector: 'app-markdown-agent-panel',
  imports: [MarkdownToolPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-markdown-tool-panel title="Agent" [icon]="Icon.AGENT">
      <p class="tool-panel-placeholder">
        An AI agent that can read the current document will appear here.
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
export class MarkdownAgentPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;
}
