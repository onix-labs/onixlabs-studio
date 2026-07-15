import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  InputSignal,
  OnInit,
  Signal,
} from '@angular/core';
import type { AgentSurface } from '@shared/api/ai-types';
import {
  AgentConversationSummary,
  ConversationContext,
} from '@shared/api/agent-conversation-channels';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentConversationPanel } from '@shared/angular/components/panels/agent-conversation-panel/agent-conversation-panel';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { MissionControl } from '@features/mission-control/angular/mission-control/mission-control';

/**
 * A single agent column in Mission Control, representing one open tab. It provides its own
 * {@link Agent} and {@link AgentConversation} — so it hosts an isolated conversation, scoped to the
 * same context as the origin tab — and reuses the shared {@link AgentConversationPanel} for the strip,
 * transcript, and composer. A header frames it with the tab's name, a live run-state pill, a transport
 * toggle, and a jump-to-tab action. The tile registers with {@link MissionControl} while mounted so
 * the ribbon can stop and re-sync every tile at once, and reports its own width so the user can resize
 * it. It sits in a horizontally-scrolling row, so a fixed pixel width (not flex) is applied.
 */
@Component({
  selector: 'app-mission-control-agent-tile',
  imports: [AgentConversationPanel, AppIcon],
  templateUrl: './mission-control-agent-tile.html',
  styleUrl: './mission-control-agent-tile.scss',
  // The tile owns the conversation's lifetime: it stays mounted for as long as its tab is open, so a
  // panel-scoped conversation is safe here (unlike a dock tool stack that destroys the panel).
  providers: [Agent, AgentConversation],
  host: {
    class: 'tile',
    '[style.inline-size.px]': 'width()',
    '[class.tile--hidden]': 'hidden()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MissionControlAgentTile implements OnInit {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds this tile's agent session, provided at the component level so it is isolated per tile.
   */
  protected readonly agent: Agent = inject(Agent);

  /**
   * Holds this tile's conversation, provided at the component level and bound to the tab's context.
   */
  private readonly conversation: AgentConversation = inject(AgentConversation);

  /**
   * Holds the Mission Control state the tile registers with and reports its width to.
   */
  private readonly missionControl: MissionControl = inject(MissionControl);

  /**
   * Holds the tab registry, used to jump to the tile's origin tab.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Gets the tab this tile represents.
   */
  public readonly tab: InputSignal<Tab> = input.required<Tab>();

  /**
   * Gets a value indicating whether the Mission Control tab is the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets the tab identifier the tile's conversation is keyed to.
   */
  protected readonly tabId: Signal<string> = computed((): string => this.tab().id);

  /**
   * Gets the conversation context derived from the origin tab (a file's path, a workspace or
   * repository root), or undefined for tabs with no resource so the conversation falls back to the
   * global bucket. Shared with the origin tab's own agent so the tile lists the same stored history.
   */
  protected readonly context: Signal<ConversationContext | undefined> = computed(
    (): ConversationContext | undefined => {
      const current: Tab = this.tab();
      if (current.resourceKey === undefined) {
        return undefined;
      }
      switch (current.type) {
        case 'code':
        case 'markdown':
        case 'binary':
          return { kind: 'file', key: current.resourceKey };
        case 'directory':
          return { kind: 'workspace', key: current.resourceKey };
        case 'source-control':
          return { kind: 'repository', key: current.resourceKey };
        default:
          return undefined;
      }
    },
  );

  /**
   * Gets the tool surface the tile's runs act on, derived from the origin tab's type.
   */
  protected readonly surface: Signal<AgentSurface> = computed((): AgentSurface => {
    switch (this.tab().type) {
      case 'terminal':
        return 'terminal';
      case 'binary':
        return 'binary';
      default:
        return 'editor';
    }
  });

  /**
   * Gets the width, in pixels, the tile renders at, from the Mission Control width overrides.
   */
  protected readonly width: Signal<number> = computed((): number =>
    this.missionControl.widthFor(this.tabId()),
  );

  /**
   * Gets a value indicating whether the tile's agent is running.
   */
  protected readonly isRunning: Signal<boolean> = this.agent.isRunning;

  /**
   * Gets a value indicating whether the tile is idle: no conversation started and not running.
   */
  protected readonly isIdle: Signal<boolean> = computed(
    (): boolean => !this.agent.isRunning() && this.agent.items().length === 0,
  );

  /**
   * Gets a value indicating whether the tile is hidden — an idle tile while idle tiles are suppressed.
   * Hidden tiles stay mounted (and registered) so the ribbon's counts and actions still see them.
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
   * Holds the destroy reference used to unregister the tile from Mission Control.
   */
  private readonly destroyRef: DestroyRef = inject(DestroyRef);

  /**
   * Initializes a new instance of the {@link MissionControlAgentTile} class, binding the tab's context
   * into the conversation. The context signal is bound lazily (it reads the tab input only when
   * evaluated), so it is safe to bind here before the inputs are set.
   */
  public constructor() {
    this.conversation.bindContext(this.context);
  }

  /**
   * Registers the tile with Mission Control once its inputs are available, so the ribbon can act
   * across every tile. Unregistered when the tile is destroyed.
   */
  public ngOnInit(): void {
    const unregister: () => void = this.missionControl.registerAgent({
      tabId: this.tab().id,
      agent: this.agent,
      sync: (): void => this.syncToLatest(),
    });
    this.destroyRef.onDestroy(unregister);
  }

  /**
   * Stops the tile's running agent.
   */
  protected onStop(): void {
    this.agent.stop();
  }

  /**
   * Activates the tile's origin tab, so the conversation can be handled in its own view.
   */
  protected onOpenTab(): void {
    this.tabs.activate(this.tab().id);
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
      this.missionControl.setWidth(this.tabId(), startWidth + (moveEvent.clientX - startX));
    };
    const up: () => void = (): void => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  }

  /**
   * Re-synchronises the tile to the most recent stored conversation for its context, so a run started
   * in the origin tab (persisted there) is loaded here. A no-op when nothing is stored yet.
   */
  private syncToLatest(): void {
    const summaries: readonly AgentConversationSummary[] = this.conversation.summaries();
    if (summaries.length === 0) {
      return;
    }
    const latest: AgentConversationSummary = [...summaries].sort(
      (a: AgentConversationSummary, b: AgentConversationSummary): number => b.updatedAt - a.updatedAt,
    )[0];
    void this.conversation.open(latest.id);
  }
}
