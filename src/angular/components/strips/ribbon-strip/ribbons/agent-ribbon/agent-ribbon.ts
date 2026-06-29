import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import type { AiModelInfo, AiProviderInfo } from '../../../../../../shared/ai-types';
import { AgentEngine } from '../../../../../services/agent-engine/agent-engine';
import { AgentSessions } from '../../../../../services/agent-sessions/agent-sessions';
import { Icon } from '@shared/angular/icons/icon';
import { RibbonStripButton } from '../../ribbon-strip-button/ribbon-strip-button';
import { RibbonStripButtonSmall } from '../../ribbon-strip-button-small/ribbon-strip-button-small';
import { RibbonStripCheck } from '../../ribbon-strip-check/ribbon-strip-check';
import { RibbonStripColumn } from '../../ribbon-strip-column/ribbon-strip-column';
import { RibbonStripField } from '../../ribbon-strip-field/ribbon-strip-field';
import { RibbonStripGroup } from '../../ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '../../ribbon-strip-overflow/ribbon-strip-overflow';

/**
 * Represents the contextual ribbon shown when an agent tab is active. The Session group drives the
 * active tab's conversation through {@link AgentSessions} — New Chat clears its transcript and Stop
 * aborts its in-flight run — while the Engine group's Provider and Model fields drive the global
 * selection owned by {@link AgentEngine}. The Context and Options controls are disabled placeholders
 * for capabilities that do not exist yet.
 */
@Component({
  selector: 'app-agent-ribbon',
  imports: [RibbonStripOverflow, RibbonStripGroup, RibbonStripColumn, RibbonStripButton, RibbonStripButtonSmall, RibbonStripCheck, RibbonStripField],
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
   * Holds the global engine selection the Engine group drives.
   */
  private readonly engine: AgentEngine = inject(AgentEngine);

  /**
   * Holds the active agent tab's session the Session group drives.
   */
  private readonly sessions: AgentSessions = inject(AgentSessions);

  /**
   * Gets a value indicating whether the active tab's run is in flight.
   */
  protected readonly isRunning: Signal<boolean> = this.sessions.isRunning;

  /**
   * Gets the provider labels offered by the Provider field.
   */
  protected readonly providerLabels: Signal<readonly string[]> = computed((): readonly string[] =>
    this.engine.providers().map((provider: AiProviderInfo): string => provider.label),
  );

  /**
   * Gets the label of the selected provider, for the Provider field's value.
   */
  protected readonly providerLabel: Signal<string> = computed(
    (): string =>
      this.engine
        .providers()
        .find((provider: AiProviderInfo): boolean => provider.id === this.engine.provider())
        ?.label ?? '',
  );

  /**
   * Gets the model labels offered by the Model field.
   */
  protected readonly modelLabels: Signal<readonly string[]> = computed((): readonly string[] =>
    this.engine.models().map((model: AiModelInfo): string => model.label),
  );

  /**
   * Gets the label of the selected model, for the Model field's value.
   */
  protected readonly modelLabel: Signal<string> = computed(
    (): string =>
      this.engine.models().find((model: AiModelInfo): boolean => model.id === this.engine.model())
        ?.label ?? '',
  );

  /**
   * Starts a fresh conversation by clearing the active tab's transcript.
   */
  protected newChat(): void {
    this.sessions.newChat();
  }

  /**
   * Stops the active tab's in-flight run.
   */
  protected stop(): void {
    this.sessions.stop();
  }

  /**
   * Selects the provider matching the chosen label.
   * @param label The label emitted by the Provider field.
   */
  protected onProviderLabel(label: string): void {
    const match: AiProviderInfo | undefined = this.engine
      .providers()
      .find((provider: AiProviderInfo): boolean => provider.label === label);
    if (match !== undefined) {
      this.engine.setProvider(match.id);
    }
  }

  /**
   * Selects the model matching the chosen label.
   * @param label The label emitted by the Model field.
   */
  protected onModelLabel(label: string): void {
    const match: AiModelInfo | undefined = this.engine
      .models()
      .find((model: AiModelInfo): boolean => model.label === label);
    if (match !== undefined) {
      this.engine.setModel(match.id);
    }
  }
}
