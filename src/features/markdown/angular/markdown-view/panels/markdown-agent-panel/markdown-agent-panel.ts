import { ChangeDetectionStrategy, Component, inject, input, InputSignal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { AgentChat } from '@shared/angular/components/agent-chat/agent-chat';
import { MarkdownPanels } from '@features/markdown/angular/markdown-panels/markdown-panels';
import { ToolPanel } from '@shared/angular/components/panels/tool-panel/tool-panel';

/**
 * The Agent tool panel: an AI agent conversation docked beside the markdown editor. It hosts the
 * shared {@link AgentChat} shell, which provides its own per-instance agent session, so the panel
 * keeps an independent transcript. The panel passes its owning document id to the chat so the agent
 * reads and writes the live markdown document for this tab (including unsaved edits) through the
 * editor's command registry, rather than whichever editor is globally active.
 */
@Component({
  selector: 'app-markdown-agent-panel',
  imports: [ToolPanel, AgentChat],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-tool-panel title="Agent" [icon]="Icon.AGENT" [flush]="true" (closed)="panels.close()">
      <app-agent-chat [tabId]="documentId()" />
    </app-tool-panel>
  `,
})
export class MarkdownAgentPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the markdown panel registry the tool panel's close button dismisses this panel through.
   */
  protected readonly panels: MarkdownPanels = inject(MarkdownPanels);

  /**
   * Gets the identifier of the markdown document this agent acts on, so its in-app editor tools target
   * this tab's editor.
   */
  public readonly documentId: InputSignal<string> = input.required<string>();
}
