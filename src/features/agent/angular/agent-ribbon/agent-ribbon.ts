import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import type { AgentMode } from '@shared/api/ai-types';
import { AgentEngine } from '@shared/angular/services/agent-engine/agent-engine';
import {
  applyEngineOption,
  engineOptions,
  engineOptionValue,
} from '@shared/angular/services/agent-engine/engine-options';
import { AgentSessions } from '@shared/angular/services/agent-sessions/agent-sessions';
import { EditorCommands } from '@shared/angular/services/editor-commands/editor-commands';
import { contributeFeatureMenu } from '@shared/angular/services/app-menu/contribute-feature-menu';
import { MENU_SEPARATOR, MenuContribution } from '@shared/angular/services/app-menu/app-menu-model';
import { Log } from '@shared/angular/services/log/log';
import { Icon } from '@shared/angular/icons/icon';
import { DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { RibbonHost } from '@shared/angular/components/ribbon-strip/ribbon-host/ribbon-host';
import { RibbonStripButton } from '@shared/angular/components/ribbon-strip/ribbon-strip-button/ribbon-strip-button';
import { RibbonStripColumn } from '@shared/angular/components/ribbon-strip/ribbon-strip-column/ribbon-strip-column';
import { RibbonStripField } from '@shared/angular/components/ribbon-strip/ribbon-strip-field/ribbon-strip-field';
import { RibbonStripGroup } from '@shared/angular/components/ribbon-strip/ribbon-strip-group/ribbon-strip-group';
import { RibbonStripOverflow } from '@shared/angular/components/ribbon-strip/ribbon-strip-overflow/ribbon-strip-overflow';
import { AgentRemoteModal } from '@shared/angular/components/agent-remote-modal/agent-remote-modal';

/**
 * Represents the contextual ribbon shown when an agent tab is active. The Session group acts on the
 * conversation itself through {@link AgentSessions} — New clears its transcript, Stop aborts its
 * in-flight run, Compact summarises it, and Remote exposes the session to another machine. The View
 * group changes what is looked at rather than what is run: where the transcript is scrolled to, and
 * whether the past conversations are listed. The Engine group's fields drive the active tab's
 * connection/model selection (also through {@link AgentSessions}) and its autonomy mode, with the
 * option list drawn from {@link AgentEngine} and grouped by provider. The Attachments group attaches
 * files, folders, and the current editor selection to the conversation.
 */
@Component({
  selector: 'app-agent-ribbon',
  imports: [
    RibbonStripOverflow,
    RibbonStripGroup,
    RibbonStripColumn,
    RibbonStripButton,
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
   * Contributes this tab's menu while the agent ribbon is mounted.
   */
  private readonly menu: void = contributeFeatureMenu('agent', (): readonly MenuContribution[] => [
    {
      id: 'agent',
      label: 'Agent',
      items: [
        {
          id: 'agent.newChat',
          label: 'New Chat',
          accelerator: 'CmdOrCtrl+Shift+N',
          run: (): void => this.newChat(),
        },
        {
          id: 'agent.stop',
          label: 'Stop',
          accelerator: 'CmdOrCtrl+.',
          enabled: this.isRunning(),
          run: (): void => this.stop(),
        },
        MENU_SEPARATOR,
        {
          id: 'agent.compact',
          label: 'Compact Conversation',
          enabled: this.hasMessages(),
          run: (): void => this.compact(),
        },
        {
          id: 'agent.history',
          label: 'Conversation History',
          kind: 'checkbox',
          checked: this.historyOpen(),
          run: (): void => this.toggleHistory(),
        },
        MENU_SEPARATOR,
        {
          id: 'agent.attach',
          label: 'Attach',
          items: [
            { id: 'agent.attachFile', label: 'Files…', run: (): void => void this.attachFile() },
            {
              id: 'agent.attachFolder',
              label: 'Folder…',
              run: (): void => void this.attachFolder(),
            },
            {
              id: 'agent.attachSelection',
              label: 'Editor Selection',
              enabled: this.hasSelection(),
              run: (): void => this.attachSelection(),
            },
          ],
        },
        {
          id: 'agent.clearContext',
          label: 'Clear Attachments',
          enabled: this.hasContext(),
          run: (): void => this.clearContext(),
        },
        MENU_SEPARATOR,
        {
          id: 'agent.remoteControl',
          label: 'Remote Control',
          kind: 'checkbox',
          checked: this.remoteControlEnabled(),
          enabled: this.supportsRemoteControl(),
          run: (): void => this.onRemoteControlToggle(),
        },
      ],
    },
  ]);

  /**
   * Gets the options offered by the Engine field: every registered provider's models, each under its
   * provider's label as a group heading.
   */
  protected readonly engineOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => engineOptions(this.engine.providers()),
  );

  /**
   * Gets the active tab's selected provider/model pair, for the Engine field's value.
   */
  protected readonly engineSelection: Signal<string> = computed((): string =>
    engineOptionValue(this.sessions.provider(), this.sessions.model()),
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
   * Scrolls the active tab's transcript to its latest message.
   */
  protected scrollToBottom(): void {
    this.log.trace('agent.ribbon', 'Scroll to bottom requested');
    this.sessions.scrollToBottom();
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
   * Selects the chosen provider/model pair for the active tab.
   * @param value The provider/model pair emitted by the Engine field.
   */
  protected onEngine(value: string): void {
    this.log.debug('agent.ribbon', 'Engine selected', { value });
    applyEngineOption(value, this.engine.providers(), this.sessions);
  }
}
