import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Icon } from '../../../../../icons/icon';
import { AgentChat } from '../../../../shared/agent-chat/agent-chat';
import { MarkdownToolPanel } from '../markdown-tool-panel/markdown-tool-panel';

/**
 * The Agent tool panel: an AI agent conversation docked beside the markdown editor. It hosts the
 * shared {@link AgentChat} shell, which provides its own per-instance agent session, so the panel
 * keeps an independent transcript. The agent reads the live markdown document (including unsaved
 * edits) through the editor's read-document capability, which the active markdown editor registers
 * with the command registry.
 */
@Component({
  selector: 'app-markdown-agent-panel',
  imports: [MarkdownToolPanel, AgentChat],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-markdown-tool-panel title="Agent" [icon]="Icon.AGENT" [flush]="true">
      <app-agent-chat />
    </app-markdown-tool-panel>
  `,
})
export class MarkdownAgentPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;
}
