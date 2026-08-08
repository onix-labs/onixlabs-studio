import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
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
import { PulseDot } from '@shared/angular/components/pulse-dot/pulse-dot';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Button } from '@shared/angular/components/forms/button/button';
import { NgTemplateOutlet } from '@angular/common';
import { Icon } from '@shared/angular/icons/icon';
import { RunConfiguration } from '@shared/api/studio';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { MissionControl } from '@features/mission-control/angular/mission-control/mission-control';
import { MissionControlTiles } from '../mission-control-tiles';

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
  imports: [
    Button,
    AgentToolStrip,
    AgentChat,
    AgentConversationList,
    AppIcon,
    PulseDot,
    Modal,
    ModalContent,
    NgTemplateOutlet,
  ],
  templateUrl: './mission-control-agent-tile.html',
  styleUrl: './mission-control-agent-tile.scss',
  host: {
    class: 'tile',
    // The set width is the flex basis: tiles grow together to fill spare space, and hold their width
    // (scrolling the row) once they overflow.
    '[style.flex-basis.px]': 'width()',
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
   * Holds the tile's host element, measured at the start of a resize drag.
   */
  private readonly elementRef: ElementRef<HTMLElement> =
    inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Holds the view-scoped tile registry, so the agent rail can scroll this column into view.
   */
  private readonly tiles: MissionControlTiles = inject(MissionControlTiles);

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
   * Holds whether this tile's focus modal is open, presenting the agent panel large and centred over
   * the application. The modal mirrors the same live session as the column, so entering and leaving
   * focus mode never disturbs the conversation.
   */
  protected readonly focusOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether keyboard focus currently rests inside this tile — the user is actively working in this
   * column (typing to the agent, or having just clicked its tool-strip New chat). While this is set, the
   * tile is exempt from Hide Empty, so New chat cannot make the very column the user is interacting with
   * vanish out from under them; the exemption lifts the moment focus leaves.
   */
  private readonly focusWithin: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the tile's stable key — the origin tab id, or the host's own id for hosts with no tab.
   */
  protected readonly key: Signal<string> = computed((): string => this.host.tabId ?? this.host.id);

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
   * Gets a value indicating whether the host is empty: no conversation at all and not running.
   */
  protected readonly isEmpty: Signal<boolean> = computed(
    (): boolean => !this.agent.isRunning() && this.agent.items().length === 0,
  );

  /**
   * Gets a value indicating whether the host is idle: a settled conversation awaiting the next prompt
   * (it has messages but no run in flight).
   */
  protected readonly isIdle: Signal<boolean> = computed(
    (): boolean => !this.agent.isRunning() && this.agent.items().length > 0,
  );

  /**
   * Gets a value indicating whether the host has an owning tab to jump to (its title is clickable).
   */
  protected readonly hasTab: Signal<boolean> = computed((): boolean => this.host.tabId !== null);

  /**
   * Gets the origin tab's icon, or undefined when the host has no owning tab, so a column reads with the
   * same glyph as its tab beside the shared title.
   */
  protected readonly tabIcon: Signal<Icon | undefined> = computed((): Icon | undefined => {
    const tabId: string | null = this.host.tabId;
    return tabId === null ? undefined : this.tabs.get(tabId)?.icon;
  });

  /**
   * Gets the branch the host's project is on, or null for a host with no project behind it (or whose
   * folder is not a repository), so a workspace or repository column names the branch it works on
   * beside its title.
   */
  protected readonly branch: Signal<string | null> = computed(
    (): string | null => this.host.branch?.() ?? null,
  );

  /**
   * Gets the host's workspace default run configuration, or null when this host is not workspace-backed
   * or its workspace designates no default. Drives the header's Run button: shown only when this is
   * non-null, so the button appears exactly for a workspace column that has something to single-press.
   */
  protected readonly defaultRun: Signal<RunConfiguration | null> = computed(
    (): RunConfiguration | null => this.host.run?.defaultConfiguration() ?? null,
  );

  /**
   * Gets whether the default configuration is launching, so the Run button shows a spinner and
   * disables itself between the press and the process starting.
   */
  protected readonly runStarting: Signal<boolean> = computed(
    (): boolean => this.host.run?.starting() ?? false,
  );

  /**
   * Gets whether the default configuration is running, so the Run button becomes a Stop button.
   */
  protected readonly runRunning: Signal<boolean> = computed(
    (): boolean => this.host.run?.running() ?? false,
  );

  /**
   * Gets the text shown on the column's branch line: the branch, or a placeholder for a column with no
   * repository behind it — so every column carries the same two-line header rather than shifting its
   * chrome depending on what the agent is attached to.
   */
  protected readonly branchLabel: Signal<string> = computed(
    (): string => this.branch() ?? 'No repository',
  );

  /**
   * Gets a value indicating whether the tile is hidden — the user has manually hidden this agent, an
   * empty host while empty tiles are suppressed, or an idle host while idle tiles are suppressed.
   *
   * The three conditions are OR-ed: the per-agent hide toggle in the rail hides this column outright,
   * independently of the blanket Hide Empty and Hide Idle toggles. Hide Idle applies to every tile: an
   * idle column (a settled conversation) is decluttered wherever it lives, and remains reachable
   * through its tab and by turning the toggle back off. Hide Empty likewise declutters every empty
   * column — including agent tabs, which is what the toggle is for — with one exception: the tile the
   * user is actively working in ({@link focusWithin}) is never hidden while empty. That keeps the
   * New-chat protection (New chat empties the transcript, and hiding the column out from under the
   * button the user just clicked is the bug we are avoiding) without neutering Hide Empty for every
   * other empty agent tab, which no longer has focus and can be decluttered normally. The manual hide
   * carries no such exemption — it is the user's explicit choice.
   */
  protected readonly hidden: Signal<boolean> = computed(
    (): boolean =>
      this.missionControl.hiddenHosts().has(this.host.id) ||
      (this.isIdle() && this.missionControl.hideIdle()) ||
      (this.isEmpty() && this.missionControl.hideEmpty() && !this.focusWithin()),
  );

  /**
   * Gets the tile's run-state label shown in the header pill.
   */
  protected readonly statusLabel: Signal<string> = computed((): string =>
    this.agent.isRunning() ? 'Working' : this.agent.items().length > 0 ? 'Idle' : 'Ready',
  );

  /**
   * Gets whether the user has manually hidden this agent — the same per-agent state the rail's hide
   * toggle drives — so the header's hide button reflects and toggles it (independently of the blanket
   * Hide Empty/Hide Idle suppression that also feeds {@link hidden}).
   */
  protected readonly manuallyHidden: Signal<boolean> = computed((): boolean =>
    this.missionControl.isHostHidden(this.host.id),
  );

  /**
   * Initializes a new instance of the {@link MissionControlAgentTile} class, closing the local history
   * view whenever a conversation is opened (its id changes) so picking one from the list returns to the
   * chat, matching the shared panel's behaviour.
   */
  public constructor() {
    // Register this tile's element so the rail can scroll it into view; unregister on destroy.
    const element: HTMLElement = this.elementRef.nativeElement;
    const unregister: () => void = this.tiles.register(this.host.id, element);
    const destroyRef: DestroyRef = inject(DestroyRef);
    destroyRef.onDestroy(unregister);

    // Track whether focus rests inside this tile, so the column the user is working in is exempt from
    // Hide Empty (see the `hidden` computed). `focusin`/`focusout` bubble from the descendants; on the
    // way out, only clear the flag when focus is genuinely leaving the tile rather than moving between
    // its own children.
    const onFocusIn: () => void = (): void => this.focusWithin.set(true);
    const onFocusOut: (event: FocusEvent) => void = (event: FocusEvent): void => {
      const next: Node | null = event.relatedTarget as Node | null;
      if (next === null || !element.contains(next)) {
        this.focusWithin.set(false);
      }
    };
    element.addEventListener('focusin', onFocusIn);
    element.addEventListener('focusout', onFocusOut);
    destroyRef.onDestroy((): void => {
      element.removeEventListener('focusin', onFocusIn);
      element.removeEventListener('focusout', onFocusOut);
    });

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
   * Runs the host workspace's default configuration in its own workspace, so a background workspace's
   * agent can be launched from Mission Control without flipping to its tab. A no-op when the host has
   * no Run capability (not workspace-backed), which is also when the button is hidden.
   */
  protected onRun(): void {
    this.host.run?.run();
  }

  /**
   * Stops the host workspace's running default configuration from Mission Control.
   */
  protected onStop(): void {
    this.host.run?.stop();
  }

  /**
   * Toggles whether this agent is manually hidden, from the header's hide button — the same per-agent
   * toggle the rail row carries. Hiding collapses this column (and its rail row's state); it is shown
   * again from the rail, which stays visible.
   */
  protected toggleHidden(): void {
    this.missionControl.toggleHostHidden(this.host.id);
  }

  /**
   * Opens the focus modal, presenting this tile's agent panel large and centred.
   */
  protected openFocus(): void {
    this.focusOpen.set(true);
  }

  /**
   * Closes the focus modal, returning the agent panel to its column.
   */
  protected closeFocus(): void {
    this.focusOpen.set(false);
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
    // Measure the actual rendered width (which may exceed the set width when tiles have grown to fill
    // spare space), so the drag tracks the pointer exactly rather than jumping.
    const startWidth: number = this.elementRef.nativeElement.getBoundingClientRect().width;
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
