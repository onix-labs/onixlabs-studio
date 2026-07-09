import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import type { AgentMode, AiModelInfo, AiProviderInfo } from '@shared/api/ai-types';
import { AgentEngine } from '@shared/angular/services/agent-engine/agent-engine';
import { AgentSessions } from '@shared/angular/services/agent-sessions/agent-sessions';
import { Icon } from '@shared/angular/icons/icon';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripButtonSmall } from '@shared/angular/components/ribbon-strip/ribbon-strip-button-small/ribbon-strip-button-small';
import { RibbonStripCheck } from '@shared/angular/components/ribbon-strip/ribbon-strip-check/ribbon-strip-check';
import { RibbonStripColumn } from '@shared/angular/components/ribbon-strip/ribbon-strip-column/ribbon-strip-column';
import { RibbonStripField } from '@shared/angular/components/ribbon-strip/ribbon-strip-field/ribbon-strip-field';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';

/**
 * Represents the contextual ribbon shown when an agent tab is active. The Session group drives the
 * active tab's conversation through {@link AgentSessions} — New Chat clears its transcript and Stop
 * aborts its in-flight run — while the Engine group's Provider and Model fields drive the global
 * selection owned by {@link AgentEngine}. The Options group's Auto-scroll check drives the active
 * conversation's follow-the-tail preference; the remaining Context and Options controls are disabled
 * placeholders for capabilities that do not exist yet.
 */
@Component({
  selector: 'app-agent-ribbon',
  imports: [
    RibbonStripOverflow,
    RibbonStripGroup,
    RibbonStripColumn,
    RibbonStripButton,
    RibbonStripButtonSmall,
    RibbonStripCheck,
    RibbonStripField,
  ],
  templateUrl: './agent-ribbon.html',
  hostDirectives: [RibbonHost],
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
   * Gets a value indicating whether the active tab's conversation-history list is shown.
   */
  protected readonly historyOpen: Signal<boolean> = this.sessions.historyOpen;

  /**
   * Gets a value indicating whether the active tab's transcript follows new content as it streams.
   */
  protected readonly autoScroll: Signal<boolean> = this.sessions.autoScroll;

  /**
   * Gets the labels offered by the Mode field.
   */
  protected readonly modeLabels: readonly string[] = ['Agent', 'Chat'];

  /**
   * Gets the label of the active tab's mode, for the Mode field's value.
   */
  protected readonly modeLabel: Signal<string> = computed((): string =>
    this.sessions.mode() === 'chat' ? 'Chat' : 'Agent',
  );

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
   * Toggles the active tab's conversation-history list.
   */
  protected toggleHistory(): void {
    this.sessions.toggleHistory();
  }

  /**
   * Compacts the active tab's conversation into a summary.
   */
  protected compact(): void {
    this.sessions.compact();
  }

  /**
   * Attaches a file to the active tab's conversation context.
   */
  protected attachFile(): void {
    this.sessions.attachFile();
  }

  /**
   * Attaches a folder to the active tab's conversation context.
   */
  protected attachFolder(): void {
    this.sessions.attachFolder();
  }

  /**
   * Sets the active tab's autonomy mode from the chosen label.
   * @param label The label emitted by the Mode field.
   */
  protected onModeLabel(label: string): void {
    const mode: AgentMode = label === 'Chat' ? 'chat' : 'agent';
    this.sessions.setMode(mode);
  }

  /**
   * Sets the active tab's follow-the-tail preference.
   * @param value The new checked state emitted by the Auto-scroll check.
   */
  protected onAutoScroll(value: boolean): void {
    this.sessions.setAutoScroll(value);
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
