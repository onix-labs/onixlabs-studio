import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import type { AiModelInfo, AiProviderInfo } from '@shared/api/ai-types';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentEngine } from '@shared/angular/services/agent-engine/agent-engine';
import { formatCost, formatTokens } from '@shared/angular/services/agent/token-format';
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
   * Gets the tokens the conversation currently occupies in the context window.
   */
  protected readonly contextTokens: Signal<number> = computed((): number =>
    this.conversation.contextTokens(),
  );

  /**
   * Gets the selected model's context window in tokens, the denominator of the meter, or zero when it
   * is unknown (an unrecognised model id).
   */
  protected readonly contextWindow: Signal<number> = computed((): number => {
    const id: string = this.engine.model();
    return this.engine.models().find((model: AiModelInfo): boolean => model.id === id)?.contextWindow ?? 0;
  });

  /**
   * Gets the compact used-token label shown beside the meter (for example, `12.3k`).
   */
  protected readonly contextLabel: Signal<string> = computed((): string =>
    formatTokens(this.contextTokens()),
  );

  /**
   * Gets how full the context window is, 0–100, for the meter fill. Zero when the window is unknown.
   */
  protected readonly contextPercent: Signal<number> = computed((): number => {
    const window: number = this.contextWindow();
    return window > 0 ? Math.min(100, Math.round((this.contextTokens() / window) * 100)) : 0;
  });

  /**
   * Gets the fill level of the meter, driving its colour so a near-full context is a visible cue to
   * compact: `ok` below 75%, `warn` from 75%, `high` from 90%.
   */
  protected readonly contextLevel: Signal<'ok' | 'warn' | 'high'> = computed(
    (): 'ok' | 'warn' | 'high' => {
      const percent: number = this.contextPercent();
      return percent >= 90 ? 'high' : percent >= 75 ? 'warn' : 'ok';
    },
  );

  /**
   * Gets the full tooltip for the context readout: used and total tokens, the percentage, and the
   * accumulated cost when the provider reports one.
   */
  protected readonly contextTitle: Signal<string> = computed((): string => {
    const used: string = this.contextTokens().toLocaleString();
    const window: number = this.contextWindow();
    const base: string =
      window > 0
        ? `${used} / ${window.toLocaleString()} tokens (${this.contextPercent()}%)`
        : `${used} tokens`;
    const cost: number = this.conversation.costUsd();
    return cost > 0 ? `${base} · ${formatCost(cost)}` : base;
  });

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
