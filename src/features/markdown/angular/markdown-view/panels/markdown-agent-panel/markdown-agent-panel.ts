import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { ConversationContext } from '@shared/api/agent-conversation-channels';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AGENT_CONVERSATION_KIND } from '@shared/angular/services/agent-conversations/agent-conversation-context';
import { Documents } from '@shared/angular/services/documents/documents';
import { Icon } from '@shared/angular/icons/icon';
import { AgentConversationPanel } from '@shared/angular/components/panels/agent-conversation-panel/agent-conversation-panel';
import { MarkdownPanels } from '@features/markdown/angular/markdown-panels/markdown-panels';
import { ToolPanel } from '@shared/angular/components/panels/tool-panel/tool-panel';

/**
 * The Agent tool panel: an AI agent conversation docked beside the markdown editor. It frames the
 * shared {@link AgentConversationPanel} (strip + chat + history) in the shared tool-panel chrome. The
 * panel owns its per-tab conversation, scoped to this markdown file's path, and passes its document id
 * to the chat so the agent reads and writes the live document (including unsaved edits) for this tab.
 */
@Component({
  selector: 'app-markdown-agent-panel',
  imports: [ToolPanel, AgentConversationPanel],
  // The conversation is provided here, not by the shared conversation panel: the side-panel system
  // keeps this host mounted while hidden, so the conversation (and an in-flight run) spans hide/show.
  providers: [Agent, AgentConversation, { provide: AGENT_CONVERSATION_KIND, useValue: 'code' }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-tool-panel
      title="Agent"
      [icon]="Icon.AGENT"
      [flush]="true"
      (closed)="panels.close('agent')"
    >
      <app-agent-conversation-panel [tabId]="documentId()" [context]="fileContext()" />
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
   * Holds the document registry, used to resolve this tab's file path for the conversation context.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Gets the identifier of the markdown document this agent acts on, so its in-app editor tools target
   * this tab's editor.
   */
  public readonly documentId: InputSignal<string> = input.required<string>();

  /**
   * Gets this tab's conversation context: the markdown file's path when it is saved, else undefined so
   * the conversation falls back to its workspace/global context.
   */
  protected readonly fileContext: Signal<ConversationContext | undefined> = computed(
    (): ConversationContext | undefined => {
      const path: string | null = this.documents.get(this.documentId())?.filePath() ?? null;
      return path === null ? undefined : { kind: 'file', key: path };
    },
  );
}
