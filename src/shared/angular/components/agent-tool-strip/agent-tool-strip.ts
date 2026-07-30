import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import type { AiModelInfo, AiProviderInfo } from '@shared/api/ai-types';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentEngine } from '@shared/angular/services/agent-engine/agent-engine';
import { EditorCommands } from '@shared/angular/services/editor-commands/editor-commands';
import { Icon } from '@shared/angular/icons/icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';

/**
 * A compact tool strip for a docked agent conversation — a mini version of the standalone agent tab's
 * ribbon. It carries the session actions (New Chat, Stop, Compact), this conversation's own
 * provider/model selection, and the history toggle, so a docked panel (which has no ribbon) gets the
 * same controls. The session actions and history toggle drive the injected {@link AgentConversation};
 * the provider/model fields drive the injected {@link Agent}'s own selection (each conversation can run
 * through a different connection), with the option list drawn from the global {@link AgentEngine}.
 * Built from the shared ribbon-button and dropdown atoms so it inherits the app's control styling.
 */
@Component({
  selector: 'app-agent-tool-strip',
  imports: [Dropdown, Button],
  templateUrl: './agent-tool-strip.html',
  styleUrl: './agent-tool-strip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentToolStrip {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the conversation this strip drives (New Chat, Stop, History).
   */
  protected readonly conversation: AgentConversation = inject(AgentConversation);

  /**
   * Holds this conversation's agent session, whose own provider/model the fields drive.
   */
  private readonly agent: Agent = inject(Agent);

  /**
   * Holds the global engine, the source of the provider option list.
   */
  private readonly engine: AgentEngine = inject(AgentEngine);

  /**
   * Gets whether there is an editor selection to attach, so the Attach Selection control offers
   * itself only when it would do something.
   */
  protected readonly hasSelection: Signal<boolean> = inject(EditorCommands).hasSelection;

  /**
   * Gets the provider options offered by the Provider field.
   */
  protected readonly providerOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.engine.providers().map(
        (provider: AiProviderInfo): DropdownOption => ({
          value: provider.id,
          label: provider.label,
        }),
      ),
  );

  /**
   * Gets this conversation's selected provider id, for the Provider field's value.
   */
  protected readonly provider: Signal<string> = computed((): string => this.agent.provider());

  /**
   * Gets the model options offered by the Model field: this conversation's effective provider's models.
   */
  protected readonly modelOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.agent
        .models()
        .map((model: AiModelInfo): DropdownOption => ({ value: model.id, label: model.label })),
  );

  /**
   * Gets this conversation's selected model id, for the Model field's value.
   */
  protected readonly model: Signal<string> = computed((): string => this.agent.model());

  /**
   * Gets an external history-open state overriding the conversation's own, or null to drive the shared
   * conversation directly. A mirror (a Mission Control tile) passes its own local state so toggling
   * history there does not open the origin's history view.
   */
  public readonly history: InputSignal<boolean | null> = input<boolean | null>(null);

  /**
   * Emits when the history button is pressed while an external {@link history} state is supplied, so
   * the owner can toggle its own state.
   */
  public readonly historyToggle: OutputEmitterRef<void> = output<void>();

  /**
   * Gets the effective pressed state of the history button: the external override when supplied, else
   * the conversation's own history-open state.
   */
  protected readonly historyPressed: Signal<boolean> = computed(
    (): boolean => this.history() ?? this.conversation.historyOpen(),
  );

  /**
   * Toggles history: the owner's external state when one is supplied, otherwise the shared conversation.
   */
  protected onHistoryToggle(): void {
    if (this.history() === null) {
      this.conversation.toggleHistory();
    } else {
      this.historyToggle.emit();
    }
  }

  /**
   * Selects the provider with the chosen id for this conversation.
   * @param id The provider id emitted by the Provider field.
   */
  protected onProvider(id: string): void {
    const match: AiProviderInfo | undefined = this.engine
      .providers()
      .find((provider: AiProviderInfo): boolean => provider.id === id);
    if (match !== undefined) {
      this.agent.setProvider(match.id);
    }
  }

  /**
   * Selects the model with the chosen id for this conversation.
   * @param id The model id emitted by the Model field.
   */
  protected onModel(id: string): void {
    this.agent.setModel(id);
  }
}
