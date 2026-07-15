import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { Agent } from '@shared/angular/services/agent/agent';
import { AGENT_HOST, AgentHost } from '@shared/angular/services/agent-hosts/agent-hosts';
import { AgentChat } from '@shared/angular/components/agent-chat/agent-chat';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentConversationList } from '@shared/angular/components/agent-conversation-list/agent-conversation-list';
import { AgentToolStrip } from '@shared/angular/components/agent-tool-strip/agent-tool-strip';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { MissionControl } from '@features/mission-control/angular/mission-control/mission-control';

/**
 * A single agent column in Mission Control, mirroring one live {@link AgentHost}. The host's live
 * {@link Agent} and {@link AgentConversation} are provided into this tile's injector (by the view), so
 * the reused strip/chat/history drive the very same session as the origin tab — a run streams into
 * both, and answering here settles the origin transcript. The chat runs in {@link AgentChat.mirror}
 * mode so it does not re-register or steal the tab's attention dot. A header frames it with the host's
 * name, a live run-state pill, a transport toggle, and a jump-to-tab action; a trailing grip resizes
 * it within the horizontally-scrolling row.
 */
@Component({
  selector: 'app-mission-control-agent-tile',
  imports: [AgentToolStrip, AgentChat, AgentConversationList, AppIcon],
  templateUrl: './mission-control-agent-tile.html',
  styleUrl: './mission-control-agent-tile.scss',
  host: {
    class: 'tile',
    '[style.inline-size.px]': 'width()',
    '[class.tile--hidden]': 'hidden()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MissionControlAgentTile {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the live host this tile mirrors.
   */
  protected readonly host: AgentHost = inject(AGENT_HOST);

  /**
   * Holds the host's live agent session (the same instance the origin drives).
   */
  protected readonly agent: Agent = inject(Agent);

  /**
   * Holds the host's live conversation, driving the strip's history swap.
   */
  protected readonly conversation: AgentConversation = inject(AgentConversation);

  /**
   * Holds the Mission Control state the tile reads its width and idle preference from.
   */
  private readonly missionControl: MissionControl = inject(MissionControl);

  /**
   * Holds the tab registry, used to jump to the host's origin tab.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Gets a value indicating whether the Mission Control tab is the active tab, forwarded to the chat so
   * it follows the tail while Mission Control is on screen.
   */
  public readonly active: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds whether this tile shows the conversation-history list. Local to the tile so toggling history
   * here does not open the origin's history view — the transcript/session stay shared, but the
   * history-list view is per-tile.
   */
  protected readonly historyOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the tile's stable key — the origin tab id, or the host's own id for hosts with no tab.
   */
  protected readonly key: Signal<string> = computed(
    (): string => this.host.tabId ?? this.host.id,
  );

  /**
   * Gets the host's tab id as a chat input (undefined when the host has no owning tab).
   */
  protected readonly tabId: Signal<string | undefined> = computed(
    (): string | undefined => this.host.tabId ?? undefined,
  );

  /**
   * Gets the width, in pixels, the tile renders at, from the Mission Control width overrides.
   */
  protected readonly width: Signal<number> = computed((): number =>
    this.missionControl.widthFor(this.key()),
  );

  /**
   * Gets a value indicating whether the host's agent is running.
   */
  protected readonly isRunning: Signal<boolean> = this.agent.isRunning;

  /**
   * Gets a value indicating whether the host is idle: no conversation started and not running.
   */
  protected readonly isIdle: Signal<boolean> = computed(
    (): boolean => !this.agent.isRunning() && this.agent.items().length === 0,
  );

  /**
   * Gets a value indicating whether the tile is hidden — an idle host while idle tiles are suppressed.
   */
  protected readonly hidden: Signal<boolean> = computed(
    (): boolean => this.isIdle() && !this.missionControl.showIdle(),
  );

  /**
   * Gets the tile's run-state label shown in the header pill.
   */
  protected readonly statusLabel: Signal<string> = computed((): string =>
    this.agent.isRunning() ? 'Working' : this.agent.items().length > 0 ? 'Idle' : 'Ready',
  );

  /**
   * Initializes a new instance of the {@link MissionControlAgentTile} class, closing the local history
   * view whenever a conversation is opened (its id changes) so picking one from the list returns to the
   * chat, matching the shared panel's behaviour.
   */
  public constructor() {
    let previousId: string | null | undefined = undefined;
    effect((): void => {
      const id: string | null = this.conversation.currentId();
      untracked((): void => {
        if (previousId !== undefined && id !== previousId) {
          this.historyOpen.set(false);
        }
        previousId = id;
      });
    });
  }

  /**
   * Toggles this tile's local history view.
   */
  protected toggleHistory(): void {
    this.historyOpen.update((open: boolean): boolean => !open);
  }

  /**
   * Stops the host's running agent.
   */
  protected onStop(): void {
    this.agent.stop();
  }

  /**
   * Activates the host's origin tab, so the conversation can be handled in its own view.
   */
  protected onOpenTab(): void {
    if (this.host.tabId !== null) {
      this.tabs.activate(this.host.tabId);
    }
  }

  /**
   * Begins a width-resize drag from the tile's trailing grip, updating the tile's width live as the
   * pointer moves and ending on release.
   * @param event The pointer-down event that started the drag.
   */
  protected onResizeDown(event: PointerEvent): void {
    event.preventDefault();
    const startX: number = event.clientX;
    const startWidth: number = this.width();
    const grip: HTMLElement = event.target as HTMLElement;
    grip.setPointerCapture(event.pointerId);

    const move: (moveEvent: PointerEvent) => void = (moveEvent: PointerEvent): void => {
      this.missionControl.setWidth(this.key(), startWidth + (moveEvent.clientX - startX));
    };
    const up: () => void = (): void => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  }
}
