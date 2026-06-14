import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import type { AiModelInfo, AiProviderInfo } from '../../../../../../shared/ai-types';
import { Agent } from '../../../../../services/agent/agent';
import { Icon } from '../../../../../icons/icon';
import { RibbonButton } from '../../controls/ribbon-button/ribbon-button';
import { RibbonButtonSmall } from '../../controls/ribbon-button-small/ribbon-button-small';
import { RibbonCheck } from '../../controls/ribbon-check/ribbon-check';
import { RibbonColumn } from '../../controls/ribbon-column/ribbon-column';
import { RibbonField } from '../../controls/ribbon-field/ribbon-field';
import { RibbonGroup } from '../../controls/ribbon-group/ribbon-group';

/**
 * Represents the contextual ribbon shown when an agent tab is active. The Session and Engine groups
 * are wired to the {@link Agent} service — New Chat clears the transcript, Stop aborts the in-flight
 * run, and the Provider and Model fields drive the same selection the chat composer uses. The Context
 * and Options controls are disabled placeholders for capabilities that do not exist yet.
 */
@Component({
  selector: 'app-agent-ribbon',
  imports: [RibbonGroup, RibbonColumn, RibbonButton, RibbonButtonSmall, RibbonCheck, RibbonField],
  templateUrl: './agent-ribbon.html',
  styleUrl: '../ribbon-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentRibbon {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the agent conversation service the ribbon drives.
   */
  private readonly agent: Agent = inject(Agent);

  /**
   * Gets a value indicating whether a run is in flight.
   */
  protected readonly isRunning: Signal<boolean> = this.agent.isRunning;

  /**
   * Gets the provider labels offered by the Provider field.
   */
  protected readonly providerLabels: Signal<readonly string[]> = computed((): readonly string[] =>
    this.agent.providers().map((provider: AiProviderInfo): string => provider.label),
  );

  /**
   * Gets the label of the selected provider, for the Provider field's value.
   */
  protected readonly providerLabel: Signal<string> = computed(
    (): string =>
      this.agent
        .providers()
        .find((provider: AiProviderInfo): boolean => provider.id === this.agent.provider())?.label ??
      '',
  );

  /**
   * Gets the model labels offered by the Model field.
   */
  protected readonly modelLabels: Signal<readonly string[]> = computed((): readonly string[] =>
    this.agent.models().map((model: AiModelInfo): string => model.label),
  );

  /**
   * Gets the label of the selected model, for the Model field's value.
   */
  protected readonly modelLabel: Signal<string> = computed(
    (): string =>
      this.agent.models().find((model: AiModelInfo): boolean => model.id === this.agent.model())
        ?.label ?? '',
  );

  /**
   * Starts a fresh conversation by clearing the transcript.
   */
  protected newChat(): void {
    this.agent.clear();
  }

  /**
   * Stops the in-flight run.
   */
  protected stop(): void {
    this.agent.stop();
  }

  /**
   * Selects the provider matching the chosen label.
   * @param label The label emitted by the Provider field.
   */
  protected onProviderLabel(label: string): void {
    const match: AiProviderInfo | undefined = this.agent
      .providers()
      .find((provider: AiProviderInfo): boolean => provider.label === label);
    if (match !== undefined) {
      this.agent.setProvider(match.id);
    }
  }

  /**
   * Selects the model matching the chosen label.
   * @param label The label emitted by the Model field.
   */
  protected onModelLabel(label: string): void {
    const match: AiModelInfo | undefined = this.agent
      .models()
      .find((model: AiModelInfo): boolean => model.label === label);
    if (match !== undefined) {
      this.agent.setModel(match.id);
    }
  }
}
