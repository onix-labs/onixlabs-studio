import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentControls } from '@shared/angular/services/agent/agent-controls';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentEngine } from '@shared/angular/services/agent-engine/agent-engine';
import {
  applyEngineOption,
  engineOptions,
  engineOptionValue,
} from '@shared/angular/services/agent-engine/engine-options';
import { EditorCommands } from '@shared/angular/services/editor-commands/editor-commands';
import { Icon } from '@shared/angular/icons/icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { Menu, MenuItem } from '@shared/angular/components/menu/menu';
import { AgentRemoteModal } from '@shared/angular/components/agent-remote-modal/agent-remote-modal';

/**
 * Identifies the Attach menu's commands.
 */
const ATTACH_FILE: string = 'agent.attachFile';
const ATTACH_FOLDER: string = 'agent.attachFolder';
const ATTACH_SELECTION: string = 'agent.attachSelection';

/**
 * Identifies the "…" menu's commands.
 */
const MORE_HISTORY: string = 'agent.history';
const MORE_SCROLL_TO_TOP: string = 'agent.scrollToTop';
const MORE_SCROLL_TO_BOTTOM: string = 'agent.scrollToBottom';
const MORE_SCROLL_TO_LAST_PROMPT: string = 'agent.scrollToLastPrompt';

/**
 * A compact tool strip for a docked agent conversation — a mini version of the standalone agent tab's
 * ribbon. It carries the session actions (New Chat, Stop, Compact), this conversation's own
 * provider/model selection, an Attach menu, and a "…" menu holding the history toggle and the scroll
 * jumps, so a docked panel (which has no ribbon) gets the
 * same controls. The session actions and history toggle drive the injected {@link AgentConversation};
 * the Engine field drives the injected {@link Agent}'s own selection (each conversation can run through
 * a different connection), with the option list drawn from the global {@link AgentEngine}.
 * Built from the shared ribbon-button and dropdown atoms so it inherits the app's control styling.
 */
@Component({
  selector: 'app-agent-tool-strip',
  imports: [Dropdown, Button, AgentRemoteModal, CdkMenuTrigger, Menu],
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
   * Gets which controls are enabled, from the table shared with the ribbon.
   */
  protected readonly controls: Signal<AgentControls> = this.conversation.controls;

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
   * Gets the options offered by the Engine field: every registered provider's models, each under its
   * provider's label as a group heading.
   */
  protected readonly engineOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => engineOptions(this.engine.providers()),
  );

  /**
   * Gets this conversation's selected provider/model pair, for the Engine field's value.
   */
  protected readonly engineSelection: Signal<string> = computed((): string =>
    engineOptionValue(this.agent.provider(), this.agent.model()),
  );

  /**
   * Gets whether the effective provider supports Remote Control, so the field is offered only then.
   */
  protected readonly supportsRemoteControl: Signal<boolean> = computed((): boolean =>
    this.agent.supportsRemoteControl(),
  );

  /**
   * Gets whether this conversation is exposed via Remote Control, for the toggle's pressed state.
   */
  protected readonly remoteControlEnabled: Signal<boolean> = computed((): boolean =>
    this.agent.remoteControlEnabled(),
  );

  /**
   * Gets the Remote Control toggle's name, which states what pressing it would do.
   */
  protected readonly remoteControlLabel: Signal<string> = computed((): string =>
    this.remoteControlEnabled() ? 'Disable remote control' : 'Enable remote control',
  );

  /**
   * Holds whether the Remote Control confirmation is open. The toggle never flips on the press itself:
   * exposing a session (or dropping a peer already on one) is confirmed first.
   */
  protected readonly remoteConfirmOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets an external history-open state overriding the conversation's own, or null to drive the shared
   * conversation directly. A mirror (a Mission Control tile) passes its own local state so toggling
   * history there does not open the origin's history view.
   */
  public readonly history: InputSignal<boolean | null> = input<boolean | null>(null);

  /**
   * Emits when Conversation History is chosen while an external {@link history} state is supplied, so
   * the owner can toggle its own state.
   */
  public readonly historyToggle: OutputEmitterRef<void> = output<void>();

  /**
   * Gets the effective checked state of the Conversation History item: the external override when
   * supplied, else the conversation's own history-open state.
   */
  protected readonly historyPressed: Signal<boolean> = computed(
    (): boolean => this.history() ?? this.conversation.historyOpen(),
  );

  /**
   * Gets the Attach menu's items. Each follows the same table as the ribbon: all of them only while
   * attaching is allowed, and Attach Selection only when there is a selection to attach.
   */
  protected readonly attachItems: Signal<readonly MenuItem[]> = computed(
    (): readonly MenuItem[] => {
      const attach: boolean = this.controls().attach;
      return [
        { id: ATTACH_FILE, label: 'Attach File', icon: Icon.ATTACH, disabled: !attach },
        { id: ATTACH_FOLDER, label: 'Attach Folder', icon: Icon.FOLDER_PLUS, disabled: !attach },
        {
          id: ATTACH_SELECTION,
          label: 'Attach Selection',
          icon: Icon.SELECTION,
          disabled: !attach || !this.hasSelection(),
        },
      ];
    },
  );

  /**
   * Gets the "…" menu's items: the history switch, then the scroll jumps. The jumps are offered only
   * when there is a transcript to scroll, as on the agent ribbon.
   */
  protected readonly moreItems: Signal<readonly MenuItem[]> = computed((): readonly MenuItem[] => {
    const empty: boolean = !this.conversation.hasMessages();
    return [
      {
        id: MORE_HISTORY,
        label: 'Conversation History',
        icon: Icon.RECENT,
        checked: this.historyPressed(),
      },
      { id: 'separator', label: '', separator: true },
      {
        id: MORE_SCROLL_TO_TOP,
        label: 'Scroll to Top',
        icon: Icon.SCROLL_TO_TOP,
        disabled: empty,
      },
      {
        id: MORE_SCROLL_TO_BOTTOM,
        label: 'Scroll to Bottom',
        icon: Icon.SCROLL_TO_BOTTOM,
        disabled: empty,
      },
      {
        id: MORE_SCROLL_TO_LAST_PROMPT,
        label: 'Scroll to Last Prompt',
        icon: Icon.SCROLL_TO_LAST_PROMPT,
        disabled: empty,
      },
    ];
  });

  /**
   * Runs a command chosen from the Attach menu.
   * @param id The chosen item's identifier.
   */
  protected onAttachMenu(id: string): void {
    switch (id) {
      case ATTACH_FILE:
        this.conversation.attachFile();
        break;
      case ATTACH_FOLDER:
        this.conversation.attachFolder();
        break;
      case ATTACH_SELECTION:
        this.conversation.attachSelection();
        break;
      default:
        break;
    }
  }

  /**
   * Runs a command chosen from the "…" menu.
   * @param id The chosen item's identifier.
   */
  protected onMoreMenu(id: string): void {
    switch (id) {
      case MORE_HISTORY:
        this.onHistoryToggle();
        break;
      case MORE_SCROLL_TO_TOP:
        this.conversation.scrollToTop();
        break;
      case MORE_SCROLL_TO_BOTTOM:
        this.conversation.scrollToBottom();
        break;
      case MORE_SCROLL_TO_LAST_PROMPT:
        this.conversation.scrollToLastPrompt();
        break;
      default:
        break;
    }
  }

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
   * Selects the chosen provider/model pair for this conversation.
   * @param value The provider/model pair emitted by the Engine field.
   */
  protected onEngine(value: string): void {
    applyEngineOption(value, this.engine.providers(), this.agent);
  }

  /**
   * Asks whether to flip this conversation's Remote Control, opening the confirmation.
   */
  protected onRemoteControlToggle(): void {
    this.remoteConfirmOpen.set(true);
  }

  /**
   * Flips this conversation's Remote Control, the confirmation having been answered Yes.
   */
  protected onRemoteControlConfirmed(): void {
    this.remoteConfirmOpen.set(false);
    this.agent.setRemoteControlEnabled(!this.agent.remoteControlEnabled());
  }

  /**
   * Closes the confirmation unanswered, leaving Remote Control where it was.
   */
  protected onRemoteControlDismissed(): void {
    this.remoteConfirmOpen.set(false);
  }
}
