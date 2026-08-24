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
import { Agent } from '@shared/angular/services/agent/agent';
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
import { AgentRemoteModal } from '@shared/angular/components/agent-remote-modal/agent-remote-modal';

/**
 * A compact tool strip for a docked agent conversation — a mini version of the standalone agent tab's
 * ribbon. It carries the session actions (New Chat, Stop, Compact), this conversation's own
 * provider/model selection, and the history toggle, so a docked panel (which has no ribbon) gets the
 * same controls. The session actions and history toggle drive the injected {@link AgentConversation};
 * the Engine field drives the injected {@link Agent}'s own selection (each conversation can run through
 * a different connection), with the option list drawn from the global {@link AgentEngine}.
 * Built from the shared ribbon-button and dropdown atoms so it inherits the app's control styling.
 */
@Component({
  selector: 'app-agent-tool-strip',
  imports: [Dropdown, Button, AgentRemoteModal],
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
