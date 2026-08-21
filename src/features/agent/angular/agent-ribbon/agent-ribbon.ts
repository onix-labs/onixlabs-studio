import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import type { AgentMode, AiModelInfo, AiProviderInfo } from '@shared/api/ai-types';
import { AgentEngine } from '@shared/angular/services/agent-engine/agent-engine';
import { AgentSessions } from '@shared/angular/services/agent-sessions/agent-sessions';
import { EditorCommands } from '@shared/angular/services/editor-commands/editor-commands';
import { Log } from '@shared/angular/services/log/log';
import { Icon } from '@shared/angular/icons/icon';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripButtonSmall } from '@shared/angular/components/ribbon-strip/ribbon-strip-button-small/ribbon-strip-button-small';
import { RibbonStripColumn } from '@shared/angular/components/ribbon-strip/ribbon-strip-column/ribbon-strip-column';
import { RibbonStripField } from '@shared/angular/components/ribbon-strip/ribbon-strip-field/ribbon-strip-field';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { AgentRemoteModal } from '@shared/angular/components/agent-remote-modal/agent-remote-modal';

/**
 * Represents the contextual ribbon shown when an agent tab is active. The Session group drives the
 * active tab's conversation through {@link AgentSessions} — New clears its transcript, Stop aborts its
 * in-flight run, and Clear removes everything attached — while the Engine group's Provider and Model
 * fields drive the active tab's own connection/model selection (also through {@link AgentSessions}),
 * with the option list drawn from {@link AgentEngine}. The Attachments group attaches files, folders,
 * and the current editor selection to the conversation; the Options group drives the autonomy mode and
 * the follow-the-tail preference.
 */
@Component({
  selector: 'app-agent-ribbon',
  imports: [
    RibbonStripOverflow,
    RibbonStripGroup,
    RibbonStripColumn,
    RibbonStripButton,
    RibbonStripButtonSmall,
    RibbonStripField,
    AgentRemoteModal,
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
   * Holds the global engine, the source of the Provider field's option list.
   */
  private readonly engine: AgentEngine = inject(AgentEngine);

  /**
   * Holds the active agent tab's session the Session group drives.
   */
  private readonly sessions: AgentSessions = inject(AgentSessions);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets whether there is an editor selection to attach, so the Selection button offers itself only
   * when it would do something.
   */
  protected readonly hasSelection: Signal<boolean> = inject(EditorCommands).hasSelection;

  /**
   * Gets a value indicating whether the active tab's run is in flight.
   */
  protected readonly isRunning: Signal<boolean> = this.sessions.isRunning;

  /**
   * Gets a value indicating whether the active tab's conversation has any messages, enabling the
   * transcript controls (New, Compact).
   */
  protected readonly hasMessages: Signal<boolean> = this.sessions.hasMessages;

  /**
   * Gets a value indicating whether the active tab's conversation-history list is shown.
   */
  protected readonly historyOpen: Signal<boolean> = this.sessions.historyOpen;

  /**
   * Gets the labels offered by the Mode field.
   */
  protected readonly modeLabels: readonly string[] = ['Full agent', 'Assistant only'];

  /**
   * Gets the label of the active tab's mode, for the Mode field's value. The field has no visible label,
   * so the values themselves carry the meaning.
   */
  protected readonly modeLabel: Signal<string> = computed((): string =>
    this.sessions.mode() === 'chat' ? 'Assistant only' : 'Full agent',
  );

  /**
   * Gets whether the active tab's provider supports Remote Control, so the field shows only when it works.
   */
  protected readonly supportsRemoteControl: Signal<boolean> = this.sessions.supportsRemoteControl;

  /**
   * Gets whether the active tab's session is exposed via Remote Control, for the toggle's pressed state.
   */
  protected readonly remoteControlEnabled: Signal<boolean> = this.sessions.remoteControlEnabled;

  /**
   * Holds whether the Remote Control confirmation is open. The toggle never flips on the press itself:
   * exposing a session (or dropping a peer already on one) is confirmed first.
   */
  protected readonly remoteConfirmOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the provider labels offered by the Provider field.
   */
  protected readonly providerLabels: Signal<readonly string[]> = computed((): readonly string[] =>
    this.engine.providers().map((provider: AiProviderInfo): string => provider.label),
  );

  /**
   * Gets the label of the active tab's selected provider, for the Provider field's value.
   */
  protected readonly providerLabel: Signal<string> = computed(
    (): string =>
      this.engine
        .providers()
        .find((provider: AiProviderInfo): boolean => provider.id === this.sessions.provider())
        ?.label ?? '',
  );

  /**
   * Gets the model labels offered by the Model field (the active tab's effective provider's models).
   */
  protected readonly modelLabels: Signal<readonly string[]> = computed((): readonly string[] =>
    this.sessions.models().map((model: AiModelInfo): string => model.label),
  );

  /**
   * Gets the label of the active tab's selected model, for the Model field's value.
   */
  protected readonly modelLabel: Signal<string> = computed(
    (): string =>
      this.sessions
        .models()
        .find((model: AiModelInfo): boolean => model.id === this.sessions.model())?.label ?? '',
  );

  /**
   * Starts a fresh conversation by clearing the active tab's transcript.
   */
  protected newChat(): void {
    this.log.info('agent.ribbon', 'New chat requested');
    this.sessions.newChat();
  }

  /**
   * Stops the active tab's in-flight run.
   */
  protected stop(): void {
    this.log.info('agent.ribbon', 'Stop run requested');
    this.sessions.stop();
  }

  /**
   * Toggles the active tab's conversation-history list.
   */
  protected toggleHistory(): void {
    this.log.debug('agent.ribbon', 'Toggle history requested', { open: !this.historyOpen() });
    this.sessions.toggleHistory();
  }

  /**
   * Compacts the active tab's conversation into a summary.
   */
  protected compact(): void {
    this.log.info('agent.ribbon', 'Compact conversation requested');
    this.sessions.compact();
  }

  /**
   * Attaches a file to the active tab's conversation context.
   */
  protected attachFile(): void {
    this.log.info('agent.ribbon', 'Attach file requested');
    this.sessions.attachFile();
  }

  /**
   * Attaches a folder to the active tab's conversation context.
   */
  protected attachFolder(): void {
    this.log.info('agent.ribbon', 'Attach folder requested');
    this.sessions.attachFolder();
  }

  /**
   * Attaches the current editor selection to the active tab's conversation context.
   */
  protected attachSelection(): void {
    this.log.info('agent.ribbon', 'Attach editor selection requested');
    this.sessions.attachSelection();
  }

  /**
   * Removes everything attached to the active tab's conversation context.
   */
  protected clearContext(): void {
    this.log.info('agent.ribbon', 'Clear context requested');
    this.sessions.clearContext();
  }

  /**
   * Gets a value indicating whether anything is attached to the active tab's context, enabling the
   * Clear Context button.
   */
  protected readonly hasContext: Signal<boolean> = computed(
    (): boolean => this.sessions.contextPaths().length > 0,
  );

  /**
   * Sets the active tab's autonomy mode from the chosen label.
   * @param label The label emitted by the Mode field.
   */
  protected onModeLabel(label: string): void {
    const mode: AgentMode = label === 'Assistant only' ? 'chat' : 'agent';
    this.log.debug('agent.ribbon', 'Agent mode changed', { mode });
    this.sessions.setMode(mode);
  }

  /**
   * Asks whether to flip the active tab's Remote Control, opening the confirmation.
   */
  protected onRemoteControlToggle(): void {
    this.remoteConfirmOpen.set(true);
  }

  /**
   * Flips the active tab's Remote Control, the confirmation having been answered Yes.
   */
  protected onRemoteControlConfirmed(): void {
    this.remoteConfirmOpen.set(false);
    const enabled: boolean = !this.sessions.remoteControlEnabled();
    this.log.debug('agent.ribbon', 'Remote control changed', { enabled });
    this.sessions.setRemoteControlEnabled(enabled);
  }

  /**
   * Closes the confirmation unanswered, leaving Remote Control where it was.
   */
  protected onRemoteControlDismissed(): void {
    this.remoteConfirmOpen.set(false);
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
      this.log.debug('agent.ribbon', 'Provider selected', { provider: match.id, label });
      this.sessions.setProvider(match.id);
    }
  }

  /**
   * Selects the model matching the chosen label.
   * @param label The label emitted by the Model field.
   */
  protected onModelLabel(label: string): void {
    const match: AiModelInfo | undefined = this.sessions
      .models()
      .find((model: AiModelInfo): boolean => model.label === label);
    if (match !== undefined) {
      this.log.debug('agent.ribbon', 'Model selected', { model: match.id, label });
      this.sessions.setModel(match.id);
    }
  }
}
