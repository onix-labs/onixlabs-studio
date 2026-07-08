import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import type { AiModelInfo, AiProviderInfo } from '@shared/api/ai-types';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentEngine } from '@shared/angular/services/agent-engine/agent-engine';
import { Icon } from '@shared/angular/icons/icon';
import { RibbonStripButtonSmall } from '@shared/angular/components/ribbon-strip/ribbon-strip-button-small/ribbon-strip-button-small';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';

/**
 * A compact tool strip for a docked agent conversation — a mini version of the standalone agent tab's
 * ribbon. It carries the session actions (New Chat, Stop, Compact), the global provider/model
 * selection, and the history toggle, so a docked panel (which has no ribbon) gets the same controls.
 * The session actions and history toggle drive the injected {@link AgentConversation}; the
 * provider/model fields drive the global {@link AgentEngine}. Built from the shared ribbon-button and
 * dropdown atoms so it inherits the app's control styling rather than defining its own.
 */
@Component({
  selector: 'app-agent-tool-strip',
  imports: [RibbonStripButtonSmall, Dropdown],
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
   * Holds the global engine selection the provider/model fields drive.
   */
  private readonly engine: AgentEngine = inject(AgentEngine);

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
   * Gets the selected provider id, for the Provider field's value.
   */
  protected readonly provider: Signal<string> = computed((): string => this.engine.provider());

  /**
   * Gets the model options offered by the Model field.
   */
  protected readonly modelOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.engine
        .models()
        .map((model: AiModelInfo): DropdownOption => ({ value: model.id, label: model.label })),
  );

  /**
   * Gets the selected model id, for the Model field's value.
   */
  protected readonly model: Signal<string> = computed((): string => this.engine.model());

  /**
   * Selects the provider with the chosen id.
   * @param id The provider id emitted by the Provider field.
   */
  protected onProvider(id: string): void {
    const match: AiProviderInfo | undefined = this.engine
      .providers()
      .find((provider: AiProviderInfo): boolean => provider.id === id);
    if (match !== undefined) {
      this.engine.setProvider(match.id);
    }
  }

  /**
   * Selects the model with the chosen id.
   * @param id The model id emitted by the Model field.
   */
  protected onModel(id: string): void {
    this.engine.setModel(id);
  }
}
