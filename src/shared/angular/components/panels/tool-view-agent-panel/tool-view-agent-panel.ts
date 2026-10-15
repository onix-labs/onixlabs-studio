import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { ConversationContext } from '@shared/api/agent-conversation-channels';
import type { AgentSurface } from '@shared/api/ai-types';
import { AgentConversationPanel } from '@shared/angular/components/panels/agent-conversation-panel/agent-conversation-panel';
import { ToolPanel } from '@shared/angular/components/panels/tool-panel/tool-panel';
import { Icon } from '@shared/angular/icons/icon';

/**
 * Builds the context a tool view's conversations are filed under (#964): the tool view, keyed by its
 * agent surface, so each view's history is its own.
 * @param surface The view's agent surface.
 * @returns Returns the context.
 */
export function toolViewConversationContext(surface: AgentSurface): ConversationContext {
  return { kind: 'tool', key: surface };
}

/**
 * A tool view's docked agent (#964): the shared conversation panel on the view's own surface, under
 * the panel chrome every docked agent wears. The conversation itself is provided by the view, so a run
 * outlives the panel being closed.
 */
@Component({
  selector: 'app-tool-view-agent-panel',
  imports: [ToolPanel, AgentConversationPanel],
  template: `
    <app-tool-panel
      title="Agent"
      [icon]="Icon.AGENT"
      closeLabel="Close agent"
      [flush]="true"
      (closed)="closed.emit()"
    >
      <app-agent-conversation-panel
        [tabId]="tabId()"
        [isActive]="isActive()"
        [surface]="surface()"
        [context]="context()"
      />
    </app-tool-panel>
  `,
  styles: `
    :host {
      display: block;
      inline-size: 100%;
      block-size: 100%;
    }

    app-agent-conversation-panel {
      block-size: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolViewAgentPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the view's agent surface.
   */
  public readonly surface: InputSignal<AgentSurface> = input.required<AgentSurface>();

  /**
   * Gets the context the view's conversations are filed under.
   */
  public readonly context: InputSignal<ConversationContext> = input.required<ConversationContext>();

  /**
   * Gets the identifier of the view's tab.
   */
  public readonly tabId: InputSignal<string> = input<string>('');

  /**
   * Gets whether the panel belongs to the active, visible tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Raised when the user closes the panel.
   */
  public readonly closed: OutputEmitterRef<void> = output<void>();
}
