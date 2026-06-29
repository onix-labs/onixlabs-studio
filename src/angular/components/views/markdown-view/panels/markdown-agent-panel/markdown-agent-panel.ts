import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { AgentChat } from '../../../../shared/agent-chat/agent-chat';
import { MarkdownToolPanel } from '../markdown-tool-panel/markdown-tool-panel';

/**
 * The Agent tool panel: an AI agent conversation docked beside the markdown editor. It hosts the
 * shared {@link AgentChat} shell, which provides its own per-instance agent session, so the panel
 * keeps an independent transcript. The panel passes its owning document id to the chat so the agent
 * reads and writes the live markdown document for this tab (including unsaved edits) through the
 * editor's command registry, rather than whichever editor is globally active.
 */
@Component({
  selector: 'app-markdown-agent-panel',
  imports: [MarkdownToolPanel, AgentChat],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-markdown-tool-panel title="Agent" [icon]="Icon.AGENT" [flush]="true">
      <app-agent-chat [tabId]="documentId()" />
    </app-markdown-tool-panel>
  `,
})
export class MarkdownAgentPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the identifier of the markdown document this agent acts on, so its in-app editor tools target
   * this tab's editor.
   */
  public readonly documentId: InputSignal<string> = input.required<string>();
}
