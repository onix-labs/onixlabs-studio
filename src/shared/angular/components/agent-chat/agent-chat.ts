import { NgTemplateOutlet } from '@angular/common';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  input,
  InputSignal,
  OnInit,
  signal,
  Signal,
  untracked,
  viewChild,
  WritableSignal,
} from '@angular/core';
import type { AgentSurface, AiEditDecision, AiImageRef } from '@shared/api/ai-types';
import { Agent, AgentItem, AgentItemKind } from '@shared/angular/services/agent/agent';
import { formatTokens } from '@shared/angular/services/agent/token-format';
import { Settings } from '@shared/angular/services/settings/settings';
import { AgentPerf } from '@shared/angular/services/agent-perf/agent-perf';
import { AgentRequests } from '@shared/angular/services/agent-requests/agent-requests';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
import { Shell } from '@shared/angular/services/shell/shell';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { Radio } from '@shared/angular/components/forms/radio/radio';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { MarkdownView } from '@shared/angular/components/markdown-view/markdown-view';
import { AgentComposer } from '@shared/angular/components/agent-composer/agent-composer';
import { friendlyToolLabel, technicalToolName } from './tool-summary';

/**
 * How close (px) to the bottom of the message list still counts as "at the bottom" for follow-the-tail
 * scrolling, absorbing sub-pixel rounding and the last line's leading so streaming stays pinned.
 */
const BOTTOM_THRESHOLD_PX: number = 24;

/**
 * How many of the most-recent top-level transcript rows the conversation renders by default. Older
 * rows are kept in memory but left out of the DOM, so a very long conversation costs a bounded number
 * of bubbles to render. Rows beyond the window are revealed in {@link CONVERSATION_WINDOW_CHUNK}-sized
 * batches on demand.
 */
const CONVERSATION_WINDOW: number = 200;

/**
 * How many further older rows are revealed each time earlier history is loaded (by the affordance at
 * the top of the list, or by scrolling to the top).
 */
const CONVERSATION_WINDOW_CHUNK: number = 200;

/**
 * How close (px) to the top of the message list triggers loading the next batch of earlier rows, so a
 * reader scrolling up back through history keeps finding more without reaching for the button.
 */
const TOP_THRESHOLD_PX: number = 96;

/**
 * How many characters of a raw tool payload (full input or output) show before it is clipped behind
 * the "Show all" affordance. The full text is always present on the item; this only bounds what an
 * expanded tool row renders by default.
 */
const PAYLOAD_PREVIEW_CHARS: number = 1_500;

/**
 * A raw tool payload (input or output) prepared for rendering: the text to show (clipped to the preview
 * when long and not yet revealed, otherwise in full), whether it is currently clipped (which shows the
 * "Show all" affordance), and that affordance's label. Precomputed into the row so an expanded tool row
 * never slices the payload on the change-detection path — even while collapsed (see {@link TranscriptRow}).
 */
interface PayloadView {
  /**
   * Gets the text to render (the preview clip while clipped, otherwise the full payload).
   */
  readonly text: string;

  /**
   * Gets a value indicating whether the payload renders clipped (long and not yet revealed).
   */
  readonly clipped: boolean;

  /**
   * Gets the "Show all" label saying how much is hidden, or an empty string when not clipped.
   */
  readonly moreLabel: string;
}

/**
 * The precomputed input/output payload views for a tool row (either absent when the tool has none).
 */
interface RowPayloads {
  /**
   * Gets the tool's input payload view, when it has non-empty input.
   */
  readonly input?: PayloadView;

  /**
   * Gets the tool's output (or error) payload view, when it has non-empty output.
   */
  readonly output?: PayloadView;
}

/**
 * Builds a raw-payload view for a tool row: clips the text to the preview when it is long and not yet
 * revealed, and precomputes the "Show all" label. Pure, so it runs once per row rebuild rather than on
 * every change-detection pass.
 * @param itemId The tool item's id (keys the revealed set).
 * @param section Which payload of the item this is.
 * @param text The full payload text.
 * @param revealed The set of `itemId:section` keys the reader has revealed in full.
 * @returns Returns the payload view.
 */
function buildPayloadView(
  itemId: string,
  section: 'input' | 'output',
  text: string,
  revealed: ReadonlySet<string>,
): PayloadView {
  const clipped: boolean =
    text.length > PAYLOAD_PREVIEW_CHARS && !revealed.has(`${itemId}:${section}`);
  return {
    text: clipped ? text.slice(0, PAYLOAD_PREVIEW_CHARS) : text,
    clipped,
    moreLabel: clipped
      ? `Show all (${(text.length - PAYLOAD_PREVIEW_CHARS).toLocaleString()} more characters)`
      : '',
  };
}

/**
 * Identifies the kind of a rendered transcript row: the transcript item kinds plus the synthetic
 * `working` row that carries the run's live "Working…" indicator.
 */
type TranscriptRowKind = AgentItemKind | 'working';

/**
 * A transcript entry as it enters the timeline fold: the backing item (null for the synthetic working
 * row) and its row kind.
 */
interface RailEntry {
  /**
   * Gets the backing transcript item, or null for the working row.
   */
  readonly item: AgentItem | null;

  /**
   * Gets the row kind.
   */
  readonly kind: TranscriptRowKind;
}

/**
 * A transcript item prepared for rendering. The agent's own activity (assistant text, reasoning, and
 * tool calls) plus the live working indicator form a connected timeline down a shared left rail;
 * {@link connectsUp}/{@link connectsDown} say whether this row's node joins the one above/below so the
 * rail draws as one continuous line and breaks cleanly around the user's own right-aligned messages.
 */
interface TranscriptRow {
  /**
   * Gets the row's stable identity for tracking.
   */
  readonly id: string;

  /**
   * Gets the row kind.
   */
  readonly kind: TranscriptRowKind;

  /**
   * Gets the backing transcript item, or null for the synthetic working row.
   */
  readonly item: AgentItem | null;

  /**
   * Gets a value indicating whether this row sits on the agent-activity timeline rail.
   */
  readonly timeline: boolean;

  /**
   * Gets a value indicating whether the rail connects up to the previous row.
   */
  readonly connectsUp: boolean;

  /**
   * Gets a value indicating whether the rail connects down to the next row.
   */
  readonly connectsDown: boolean;

  /**
   * Gets the glyph shown on this row's timeline node.
   */
  readonly nodeIcon: Icon;

  /**
   * Gets a value indicating whether this row's node glyph spins (a live/running state).
   */
  readonly nodeSpin: boolean;

  /**
   * Gets the friendly one-line summary for a tool row, or the disclosure label of a thinking row
   * (undefined for other kinds).
   */
  readonly label?: string;

  /**
   * Gets the muted meta readout beside a thinking row's label (its word count), or undefined.
   */
  readonly meta?: string;

  /**
   * Gets the technical tool identifier revealed when a tool row is expanded (undefined otherwise).
   */
  readonly tech?: string;

  /**
   * Gets the sub-agent lane this tool row renders as (a Task spawning nested work), or undefined for
   * an ordinary tool row.
   */
  readonly lane?: LaneInfo;

  /**
   * Gets the precomputed raw input/output payload views for a tool row, or undefined for other kinds.
   */
  readonly payloads?: RowPayloads;
}

/**
 * A sub-agent (Task) tool row prepared for rendering as a collapsible lane: a live status line while
 * it runs, a tools/tokens meta readout, and the nested activity revealed on expand.
 */
interface LaneInfo {
  /**
   * Gets the lane's title: the sub-agent's type (e.g. `Explore`), or a generic fallback.
   */
  readonly title: string;

  /**
   * Gets the live status line: the friendly label of the tool currently running, or the settled
   * done/failed state.
   */
  readonly status: string;

  /**
   * Gets the tools/tokens meta readout (for example, `3 tools, 12.1k tokens`), or an empty string.
   */
  readonly meta: string;

  /**
   * Gets the sub-agent's own activity as its own timeline, built with the same shape as the parent
   * transcript so it renders identically — the same rail, nodes, expandable tool rows, reasoning
   * disclosures, and bubbles — only nested inside the lane. A sub-agent that itself spawns a
   * sub-agent nests again through each tool row's own {@link TranscriptRow.lane}.
   */
  readonly rows: readonly TranscriptRow[];
}

/**
 * Renders one agent conversation as a structured, provider-agnostic transcript above an
 * {@link AgentComposer}: user/assistant turns (assistant text rendered as markdown), dim reasoning,
 * tool-activity chips, and inline permission prompts. It is a thin capability wrapper around the
 * {@link Agent} session, which the host provides (so the host's controls and history list share the
 * same transcript); this component owns no session controls, history, or persistence. The composer is
 * a sibling component rather than part of this view, so typing does not re-check the (potentially
 * long) transcript's bindings — keeping per-keystroke cost flat as a conversation grows. Links in
 * agent output open in the OS browser rather than navigating the app.
 */
@Component({
  selector: 'app-agent-chat',
  imports: [Button, AppIcon, MarkdownView, NgTemplateOutlet, Radio, Dropdown, AgentComposer],
  templateUrl: './agent-chat.html',
  styleUrl: './agent-chat.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentChat implements OnInit {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds this conversation's agent session, provided by the host so its controls and history share
   * the same transcript.
   */
  private readonly agent: Agent = inject(Agent);

  /**
   * Holds the tab registry, used to light this conversation's tab while it awaits a decision.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the shell client, used to open link clicks in the operating system's default browser.
   */
  private readonly shell: Shell = inject(Shell);

  /**
   * Holds the app-wide agent-requests registry this conversation reports its pending requests to.
   */
  private readonly requests: AgentRequests = inject(AgentRequests);

  /**
   * Holds the app-wide live-hosts registry this conversation registers with, so surfaces such as
   * Mission Control can mirror it. Skipped when this chat is itself a mirror.
   */
  private readonly hosts: AgentHosts = inject(AgentHosts);

  /**
   * Holds the host-provided conversation, registered with {@link AgentHosts} so a mirror can drive the
   * same session. Optional so the component still stands up in isolation (tests).
   */
  private readonly conversation: AgentConversation | null = inject(AgentConversation, {
    optional: true,
  });

  /**
   * Holds the destroy notifier used to unregister this conversation's registrations.
   */
  private readonly destroyRef: DestroyRef = inject(DestroyRef);

  /**
   * Holds the settings service, the source of the global auto-scroll preference (applied to every agent
   * view).
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the transcript-performance probe (GitHub #408 instrumentation): times each rows rebuild and
   * counts how many transcript views are mounted at once (the Mission Control multiplier).
   */
  private readonly perf: AgentPerf = inject(AgentPerf);

  /**
   * Gets the identifier of the tab hosting this conversation, or undefined when not hosted by a tab
   * (e.g. the dockable agent panel).
   */
  public readonly tabId: InputSignal<string | undefined> = input<string | undefined>(undefined);

  /**
   * Gets a value indicating whether the hosting tab is the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets a value indicating whether this chat is actually on screen, which gates whether the transcript
   * is rendered at all.
   *
   * A hidden view costs as much as a visible one. Every open tab stays mounted (hidden with a class,
   * not destroyed), so an agent tab sitting behind Mission Control kept re-checking all of its rendered
   * rows on every streamed token — measured at the same DOM size as the active view, for something
   * nobody could see. Several conversations streaming into several views each is what saturates the
   * main thread, and a saturated main thread is what makes typing crawl.
   *
   * Deliberately **not** {@link isActive}, and deliberately defaulting to true. The two part company
   * where a chat is shown while its tab is not active — Mission Control's focus modal is a separate
   * window over an inactive tab — and a gate that defaults to hidden would blank a transcript the
   * moment a caller forgot to pass it. Defaulting to shown means the worst a forgetful caller gets is
   * today's cost.
   *
   * The transcript is safe to drop and rebuild because it is pure derived state — unlike Monaco or a
   * terminal, which is why those must stay mounted. The reader's distance from the tail is preserved
   * across the gate, so returning to a tab lands where they left it.
   */
  public readonly visible: InputSignal<boolean> = input<boolean>(true);

  /**
   * Gets what this conversation's runs act on, which selects the tool set the providers expose: the
   * open editor document (`editor`, the default) or the owning terminal (`terminal`).
   */
  public readonly surface: InputSignal<AgentSurface> = input<AgentSurface>('editor');

  /**
   * Gets a value indicating whether this chat is a mirror of another host's conversation (a Mission
   * Control tile). A mirror drives the shared session but does not register as its own host, report its
   * pending requests again, or light the tab's attention dot — the origin already does.
   */
  public readonly mirror: InputSignal<boolean> = input<boolean>(false);

  /**
   * References the scrolling message list, whose scroll position is followed as content streams in.
   */
  private readonly messagesRef: Signal<ElementRef<HTMLElement> | undefined> =
    viewChild<ElementRef<HTMLElement>>('messages');

  /**
   * Holds whether the reader is at (or within {@link BOTTOM_THRESHOLD_PX} of) the bottom of the
   * message list. Follow-the-tail scrolling only pins while this is true, so scrolling up to read back
   * pauses it and scrolling back down resumes it. Reset to true on send so a new turn re-pins.
   */
  private readonly atBottom: WritableSignal<boolean> = signal<boolean>(true);

  /**
   * Holds how many of the most-recent top-level rows the list renders (see {@link CONVERSATION_WINDOW}).
   * Grows by {@link CONVERSATION_WINDOW_CHUNK} as the reader loads earlier history; only ever caps
   * rendering when the transcript is longer than the window.
   */
  private readonly windowSize: WritableSignal<number> = signal<number>(CONVERSATION_WINDOW);

  /**
   * Holds the reader's distance from the bottom of the list (px) captured just before earlier rows are
   * loaded, so their prepend can be absorbed by restoring that distance — keeping the viewport visually
   * still rather than jumping. Null when no load is pending.
   */
  private pendingScrollAnchor: number | null = null;

  /**
   * Holds how many times the tail has been asked for explicitly, so a jump can be told apart from the
   * ordinary follow and honoured even with the follow preference off.
   */
  private readonly pinRequests: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the request count the pin effect has already served.
   */
  private appliedPinRequest: number = 0;

  /**
   * Holds whether the next scroll event is the one this component just caused by pinning to the tail.
   *
   * A pin's landing must not be read as the reader scrolling away from the tail. It can genuinely land
   * short of the true bottom — rows below the fold are laid out lazily, so their real heights only
   * arrive once they are scrolled into view — and reading that as "the reader has scrolled up" would
   * switch the follow off for good, on the first message that grew after the pin. Swallowing our own
   * event leaves the follow on, and the next render pins again against the now-measured height.
   */
  private selfScrolled: boolean = false;

  /**
   * Holds each item's rendered word count, keyed by the item's identity. Items are immutable — a
   * text update replaces the object — so the cache self-invalidates, and unchanged thinking rows
   * stop re-splitting their whole text on every transcript rebuild.
   */
  private readonly wordCountCache: WeakMap<AgentItem, string> = new WeakMap<AgentItem, string>();

  /**
   * Renders a labelled word count for a block of text.
   * @param text The text to count.
   * @returns Returns the labelled count (for example, `12 words`).
   */
  private wordCountOf(text: string): string {
    const words: number = text
      .trim()
      .split(/\s+/)
      .filter((word: string): boolean => word.length > 0).length;
    return words === 1 ? '1 word' : `${words} words`;
  }

  /**
   * Renders a labelled word count for an item's text, memoized by item identity.
   * @param item The item whose text to count, or null for none.
   * @returns Returns the labelled count.
   */
  private wordCountFor(item: AgentItem | null): string {
    if (item === null) {
      return this.wordCountOf('');
    }
    let cached: string | undefined = this.wordCountCache.get(item);
    if (cached === undefined) {
      cached = this.wordCountOf(item.text);
      this.wordCountCache.set(item, cached);
    }
    return cached;
  }

  /**
   * Gets the transcript rendered in the message list.
   */
  public readonly items: Signal<readonly AgentItem[]> = this.agent.items;

  /**
   * Gets a value indicating whether a run is in flight.
   */
  public readonly isRunning: Signal<boolean> = this.agent.isRunning;

  /**
   * Gets a value indicating whether the agent is waiting on the user (a permission decision or an
   * answer to a question).
   */
  public readonly awaitingDecision: Signal<boolean> = this.agent.awaitingDecision;

  /**
   * Gets the question the agent is currently waiting on, or undefined when none is pending. Read only
   * to reset the transcript's radio selection when a fresh question arrives.
   */
  public readonly pendingInput: Signal<AgentItem | undefined> = this.agent.pendingInput;

  /**
   * Holds the label of the suggested choice currently selected on the pending question's radio group,
   * or null when none is selected yet. Reset whenever the pending question changes.
   */
  protected readonly selectedChoice: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the remember scope selected on each pending permission card, keyed by item id ('once' when
   * unset). Parallel sub-agents can raise concurrent prompts, so the selection is per card.
   */
  protected readonly rememberChoice: WritableSignal<Readonly<Record<string, string | undefined>>> =
    signal<Readonly<Record<string, string | undefined>>>({});

  /**
   * Holds the id of the transcript item whose text was just copied, driving the transient "Copied"
   * feedback on its button; null when none.
   */
  protected readonly copiedId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the timer that clears the transient copied feedback, or null when none is pending.
   */
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds the keys (`itemId:section`) of the raw tool payloads the user has revealed in full,
   * lifting their preview clip.
   */
  private readonly revealedPayloads: WritableSignal<ReadonlySet<string>> = signal<
    ReadonlySet<string>
  >(new Set<string>());

  /**
   * Gets the assistant item the Retry affordance sits under: the conversation's final top-level
   * assistant reply, provided a user message precedes it and no run is in flight. Null when there is
   * nothing to retry.
   */
  protected readonly retryTarget: Signal<{ assistantId: string; user: AgentItem } | null> =
    computed((): { assistantId: string; user: AgentItem } | null => {
      if (this.isRunning()) {
        return null;
      }
      const items: readonly AgentItem[] = this.items();
      let user: AgentItem | null = null;
      let assistantId: string | null = null;
      for (const item of items) {
        if (item.kind === 'user') {
          user = item;
          assistantId = null;
        } else if (item.kind === 'assistant' && item.parentToolId === undefined && user !== null) {
          assistantId = item.id;
        }
      }
      return user !== null && assistantId !== null ? { assistantId, user } : null;
    });

  /**
   * Gets the transcript prepared for rendering: each item plus the live working indicator, tagged with
   * timeline-rail connectivity and, for tool rows, a friendly label and technical name. The agent's
   * own activity (assistant text, reasoning, tool calls, and the working indicator) forms one
   * connected rail; the user's messages and permission prompts sit off it and break the line.
   *
   * Empty while the chat is not {@link visible}, which is the cheap half of the fix: a hidden view
   * neither builds rows nor renders them, so a streamed token costs it nothing at all. The gate sits
   * here rather than on the rendered rows so that the build itself is skipped too — `earlierCount`
   * reads this, so gating only the rendering would leave the per-flush build running unseen.
   */
  protected readonly transcript: Signal<{ rows: readonly TranscriptRow[]; total: number }> =
    computed((): { rows: readonly TranscriptRow[]; total: number } => {
      if (!this.visible()) {
        return { rows: [], total: 0 };
      }
      const items: readonly AgentItem[] = this.items();
      const showWorking: boolean = this.isRunning() && !this.awaitingDecision();
      const revealed: ReadonlySet<string> = this.revealedPayloads();
      // Sub-agent items nest under their spawning Task tool row (its lane) rather than the main rail.
      const children: Map<string, AgentItem[]> = new Map<string, AgentItem[]>();
      for (const item of items) {
        if (item.parentToolId !== undefined) {
          const list: AgentItem[] = children.get(item.parentToolId) ?? [];
          list.push(item);
          children.set(item.parentToolId, list);
        }
      }
      const base: RailEntry[] = items
        .filter((item: AgentItem): boolean => item.parentToolId === undefined)
        .map((item: AgentItem): RailEntry => ({ item, kind: item.kind }));
      const sequence: readonly RailEntry[] = showWorking
        ? [...base, { item: null, kind: 'working' }]
        : base;
      // Window at the entries level (step 2): build only the most-recent top-level rows, keeping the
      // working indicator (always the tail). Slicing before the O(rows) build bounds the rebuild — which
      // re-runs on every stream flush — to the window rather than the whole conversation.
      const size: number = this.windowSize();
      const windowed: readonly RailEntry[] =
        sequence.length <= size ? sequence : sequence.slice(sequence.length - size);
      // A thinking row is live while the run is still producing it (it is the newest item); it
      // streams into its disclosure and its collapsed summary reads as progress.
      const lastItemId: string | undefined = items[items.length - 1]?.id;
      const thinking: (entry: RailEntry) => boolean = (entry: RailEntry): boolean =>
        entry.kind === 'thinking';
      const thinkingLive: (entry: RailEntry) => boolean = (entry: RailEntry): boolean =>
        thinking(entry) && this.isRunning() && entry.item?.id === lastItemId;

      const wordCountFor: (item: AgentItem | null) => string = (item: AgentItem | null): string =>
        this.wordCountFor(item);

      const onRail: (kind: TranscriptRowKind) => boolean = (kind: TranscriptRowKind): boolean =>
        kind === 'assistant' || kind === 'thinking' || kind === 'tool' || kind === 'working';

      // A backgrounded tool is still live: its result came back the instant it backgrounded, but the
      // work carries on until the task settles. Treating it as finished is the lie #427 exists to fix.
      const running: (entry: RailEntry) => boolean = (entry: RailEntry): boolean =>
        entry.kind === 'tool' &&
        (entry.item?.toolState === 'running' || entry.item?.toolState === 'backgrounded');

      const nodeIconFor: (entry: RailEntry) => Icon = (entry: RailEntry): Icon => {
        switch (entry.kind) {
          case 'assistant':
            return Icon.AGENT;
          case 'thinking':
            return thinkingLive(entry) ? Icon.SPINNER : Icon.THINKING;
          case 'working':
            return Icon.SPINNER;
          case 'tool':
            if (entry.item?.toolState === 'running' || entry.item?.toolState === 'backgrounded') {
              return Icon.SPINNER;
            }
            if (entry.item?.toolState === 'error') {
              return Icon.WARNING;
            }
            // A settled sub-agent (Task) row wears the sub-agent glyph, so lanes read differently
            // from ordinary tool chips on the rail.
            return entry.item?.agentType !== undefined ? Icon.SUBAGENT : Icon.ACTION;
          default:
            return Icon.ACTION;
        }
      };

      // Prepares a Task tool item as a sub-agent lane, or returns undefined for an ordinary tool row
      // (no sub-agent type and no nested activity). The lane's own rows are built with the passed rail
      // builder so the sub-agent's activity is a real nested timeline, not a flattened list.
      const laneFor: (
        item: AgentItem,
        build: (entries: readonly RailEntry[]) => readonly TranscriptRow[],
      ) => LaneInfo | undefined = (
        item: AgentItem,
        build: (entries: readonly RailEntry[]) => readonly TranscriptRow[],
      ): LaneInfo | undefined => {
        const kids: readonly AgentItem[] = children.get(item.toolId ?? '') ?? [];
        if (item.agentType === undefined && kids.length === 0) {
          return undefined;
        }
        const tools: readonly AgentItem[] = kids.filter(
          (kid: AgentItem): boolean => kid.kind === 'tool',
        );
        const active: AgentItem | undefined = [...tools]
          .reverse()
          .find((tool: AgentItem): boolean => tool.toolState === 'running');
        const status: string =
          item.toolState === 'running'
            ? `${active !== undefined ? friendlyToolLabel(active.toolName) : 'Working'}…`
            : item.toolState === 'backgrounded'
              ? 'In background…'
              : item.toolState === 'error'
                ? 'Failed'
                : 'Done';
        const meta: string[] = [];
        if (tools.length > 0) {
          meta.push(tools.length === 1 ? '1 tool' : `${tools.length} tools`);
        }
        const tokens: number = item.agentTokens ?? 0;
        if (tokens > 0) {
          meta.push(`${formatTokens(tokens)} tokens`);
        }
        return {
          title: item.agentType ?? 'Sub-agent',
          status,
          meta: meta.join(', '),
          rows: build(kids.map((kid: AgentItem): RailEntry => ({ item: kid, kind: kid.kind }))),
        };
      };

      // Builds a run of rail rows (the top-level transcript, or a sub-agent's nested activity). A
      // tool row that spawned a sub-agent carries a lane whose own rows are built by this same
      // function, so a sub-agent renders exactly like the parent — the same rail, nodes, expandable
      // tool rows, reasoning, and bubbles — nested to any depth. The `build` name lets the map
      // callback recurse without a forward reference.
      const buildRail: (entries: readonly RailEntry[]) => readonly TranscriptRow[] = function build(
        entries: readonly RailEntry[],
      ): readonly TranscriptRow[] {
        return entries.map((row: RailEntry, index: number): TranscriptRow => {
          const timeline: boolean = onRail(row.kind);
          const previous: RailEntry | undefined = entries[index - 1];
          const next: RailEntry | undefined = entries[index + 1];
          const lane: LaneInfo | undefined =
            row.kind === 'tool' && row.item !== null ? laneFor(row.item, build) : undefined;
          return {
            id: row.item?.id ?? 'working',
            kind: row.kind,
            item: row.item,
            timeline,
            connectsUp: timeline && previous !== undefined && onRail(previous.kind),
            connectsDown: timeline && next !== undefined && onRail(next.kind),
            nodeIcon: nodeIconFor(row),
            nodeSpin: row.kind === 'working' || running(row) || thinkingLive(row),
            label:
              row.kind === 'tool'
                ? friendlyToolLabel(row.item?.toolName)
                : thinking(row)
                  ? thinkingLive(row)
                    ? 'Thinking…'
                    : 'Thought process'
                  : undefined,
            meta: thinking(row) ? wordCountFor(row.item) : undefined,
            tech: row.kind === 'tool' ? technicalToolName(row.item?.toolName) : undefined,
            lane,
            // Precompute the raw payload clips (step 3) so an expanded tool row never slices strings on
            // the change-detection path. Only non-empty payloads produce a view, matching the template's
            // previous truthiness gate.
            payloads:
              row.kind === 'tool' && row.item !== null
                ? {
                    ...(row.item.toolInput
                      ? {
                          input: buildPayloadView(
                            row.item.id,
                            'input',
                            row.item.toolInput,
                            revealed,
                          ),
                        }
                      : {}),
                    ...(row.item.toolOutput
                      ? {
                          output: buildPayloadView(
                            row.item.id,
                            'output',
                            row.item.toolOutput,
                            revealed,
                          ),
                        }
                      : {}),
                  }
                : undefined,
          };
        });
      };

      // Time the rebuild for the #408 transcript probe. Only the windowed rows are built (step 2), so
      // the cost is bounded by the window rather than the whole conversation; `items.length` records the
      // total the window was taken from.
      const start: number = performance.now();
      const built: readonly TranscriptRow[] = buildRail(windowed);
      this.perf.rowsBuilt(performance.now() - start, items.length, built.length);
      return { rows: built, total: sequence.length };
    });

  /**
   * Gets the rows actually rendered: the most-recent {@link windowSize} top-level rows, already built
   * by {@link transcript} (the window is applied before the build). Each row keeps its nested sub-agent
   * lane intact and stays anchored to the tail as the transcript grows, so streaming and
   * follow-the-tail are unaffected.
   */
  protected readonly windowedRows: Signal<readonly TranscriptRow[]> = computed(
    (): readonly TranscriptRow[] => this.transcript().rows,
  );

  /**
   * Gets how many older top-level rows are held back from the DOM — the count offered by the
   * "load earlier" affordance, and zero when the whole transcript is rendered.
   */
  protected readonly earlierCount: Signal<number> = computed((): number => {
    const built: { rows: readonly TranscriptRow[]; total: number } = this.transcript();
    return built.total - built.rows.length;
  });

  /**
   * Initializes a new instance of the {@link AgentChat} class, lighting the hosting tab's attention dot
   * while the conversation awaits a permission decision in the background.
   */
  public constructor() {
    // Count this transcript view against the live total (the Mission Control mount multiplier) for the
    // #408 probe, releasing it on teardown.
    this.perf.transcriptMounted();
    this.destroyRef.onDestroy((): void => this.perf.transcriptUnmounted());

    effect((): void => {
      const id: string | undefined = this.tabId();
      const waiting: boolean = this.awaitingDecision();
      const active: boolean = this.isActive();
      untracked((): void => {
        // A mirror never lights the tab — the origin conversation already owns the attention dot.
        if (id !== undefined && !this.mirror()) {
          this.tabs.setAttention(id, waiting && !active);
        }
      });
    });

    // A fresh question starts with nothing selected: reset the radio selection whenever the pending
    // question changes (including when it settles).
    effect((): void => {
      this.pendingInput();
      untracked((): void => this.selectedChoice.set(null));
    });

    // Hiding the transcript drops its DOM, so remember how far the reader was from the tail and put
    // them back there when it returns. Without this, coming back to a tab you had scrolled up in would
    // land at the top of the window; the anchor is the same "distance from the bottom" the load-earlier
    // restore uses, so returning to a tab behaves exactly as revealing older rows does.
    effect((): void => {
      const showing: boolean = this.visible();
      untracked((): void => {
        if (showing) {
          return;
        }
        const element: HTMLElement | undefined = this.messagesRef()?.nativeElement;
        // At the tail there is nothing to preserve — the follow-the-tail effect re-pins on return,
        // which is both cheaper and more correct while the agent is still streaming.
        if (element !== undefined && !this.atBottom()) {
          this.pendingScrollAnchor = element.scrollHeight - element.scrollTop;
        }
      });
    });

    // A surface asking for the tail — the ribbon's or the tool strip's Scroll to Bottom — pins this
    // transcript. Every surface showing the conversation answers, since they all show the same one.
    effect((): void => {
      const requested: number = this.conversation?.tailRequest() ?? 0;
      untracked((): void => {
        if (requested > 0) {
          this.scrollToBottom();
        }
      });
    });

    // Follow the tail: after each render that grows the transcript (streamed text, a new row, or the
    // working indicator), pin the list to the bottom while the preference is on and the reader is
    // already there. Reading the rendered rows re-runs this as the transcript streams.
    //
    // An explicit jump overrides both conditions: it was asked for, so the preference (which governs
    // the automatic follow) and where the reader had scrolled to are beside the point.
    afterRenderEffect((): void => {
      this.windowedRows();
      const requested: number = this.pinRequests();
      const explicit: boolean = requested !== this.appliedPinRequest;
      this.appliedPinRequest = requested;
      if (!explicit && (!this.settings.aiAutoScroll() || !this.atBottom())) {
        return;
      }
      const element: HTMLElement | undefined = this.messagesRef()?.nativeElement;
      if (element === undefined) {
        return;
      }
      const before: number = element.scrollTop;
      element.scrollTop = element.scrollHeight;
      // Only claim the scroll event when the position actually moved: an assignment that changes
      // nothing raises no event, and a flag left standing would swallow the reader's next scroll.
      if (element.scrollTop !== before) {
        this.selfScrolled = true;
      }
    });

    // After earlier rows are prepended, restore the reader's distance from the bottom so the content
    // they were reading stays put rather than jumping down by the height of the newly-revealed rows.
    afterRenderEffect((): void => {
      this.windowedRows();
      const anchor: number | null = this.pendingScrollAnchor;
      if (anchor === null) {
        return;
      }
      this.pendingScrollAnchor = null;
      const element: HTMLElement | undefined = this.messagesRef()?.nativeElement;
      if (element !== undefined) {
        element.scrollTop = element.scrollHeight - anchor;
      }
    });
  }

  /**
   * Gets the display label this conversation is attributed to: the hosting tab's title, or a generic
   * panel name when there is no owning tab. Reactive, so a renamed tab updates its Mission Control
   * column and its requests-inbox heading.
   */
  private readonly hostLabel: Signal<string> = computed((): string => {
    const id: string | undefined = this.tabId();
    if (id !== undefined) {
      return this.tabs.tabs().find((tab: Tab): boolean => tab.id === id)?.title ?? 'Agent';
    }
    return 'Agent panel';
  });

  /**
   * Registers this conversation once its inputs are available: its pending requests with the app-wide
   * requests registry (the title strip's bell), and — when it owns a conversation — its live session
   * with {@link AgentHosts} so surfaces such as Mission Control can mirror the same transcript and run.
   * A mirror registers neither: the origin conversation already does, and a second registration would
   * double-count its requests and list it twice.
   */
  public ngOnInit(): void {
    if (this.mirror()) {
      return;
    }

    const unregisterRequests: () => void = this.requests.register({
      agent: this.agent,
      tabId: (): string | null => this.tabId() ?? null,
      label: (): string => this.hostLabel(),
    });
    this.destroyRef.onDestroy(unregisterRequests);

    if (this.conversation !== null) {
      const unregisterHost: () => void = this.hosts.register({
        tabId: this.tabId() ?? null,
        label: this.hostLabel,
        surface: this.surface(),
        agent: this.agent,
        conversation: this.conversation,
        isActive: this.isActive,
      });
      this.destroyRef.onDestroy(unregisterHost);
    }
  }

  /**
   * Records whether the reader is at the bottom of the message list as they scroll, which gates
   * follow-the-tail pinning. A programmatic pin lands at the bottom and keeps this true; scrolling up
   * clears it and pauses the follow until the reader returns to the bottom.
   * @param element The scrolling message list.
   */
  public onScroll(element: HTMLElement): void {
    // Our own pin's landing is not the reader moving; see `selfScrolled`.
    if (this.selfScrolled) {
      this.selfScrolled = false;
      return;
    }
    const distance: number = element.scrollHeight - element.scrollTop - element.clientHeight;
    this.atBottom.set(distance <= BOTTOM_THRESHOLD_PX);
    // Reaching the top pulls the next batch of older rows into view, keeping the scroll position
    // stable (see the anchor-restore effect). Guarded so the restore's landing does not re-trigger.
    if (
      element.scrollTop <= TOP_THRESHOLD_PX &&
      this.earlierCount() > 0 &&
      this.pendingScrollAnchor === null
    ) {
      this.showEarlier(element);
    }
  }

  /**
   * Reveals the next batch of older rows, anchoring the scroll position to the bottom so the prepend
   * does not shift what the reader is looking at.
   * @param element The scrolling message list, when a scroll position should be preserved.
   */
  public showEarlier(element?: HTMLElement): void {
    const list: HTMLElement | undefined = element ?? this.messagesRef()?.nativeElement;
    this.pendingScrollAnchor = list !== undefined ? list.scrollHeight - list.scrollTop : null;
    this.windowSize.update((size: number): number => size + CONVERSATION_WINDOW_CHUNK);
  }

  /**
   * Jumps the transcript to its latest message and resumes following the tail, whatever the reader's
   * scroll position and whatever the follow preference — this is asked for explicitly, by the ribbon's
   * or the tool strip's Scroll to Bottom.
   */
  public scrollToBottom(): void {
    this.atBottom.set(true);
    this.pinRequests.update((count: number): number => count + 1);
  }

  /**
   * Re-pins the transcript to the tail when the composer dispatches a message, even if the reader had
   * scrolled up to read back.
   */
  public onSent(): void {
    this.atBottom.set(true);
  }

  /**
   * Copies a transcript item's raw text (the markdown source, not the rendered HTML) to the
   * clipboard, flashing a transient "Copied" state on its button.
   * @param item The user or assistant item to copy.
   */
  public copy(item: AgentItem): void {
    void navigator.clipboard.writeText(item.text).then((): void => {
      this.copiedId.set(item.id);
      if (this.copiedTimer !== null) {
        clearTimeout(this.copiedTimer);
      }
      this.copiedTimer = setTimeout((): void => this.copiedId.set(null), 1500);
    });
  }

  /**
   * Marks a suggested choice as selected on the pending question's radio group. Answering happens on
   * confirm, so a mis-click is recoverable.
   * @param label The selected choice's label.
   */
  public selectChoice(label: string): void {
    this.selectedChoice.set(label);
  }

  /**
   * Answers a pending agent question with the selected choice. Ignored while nothing is selected.
   * @param item The input-request item.
   */
  public confirmChoice(item: AgentItem): void {
    const choice: string | null = this.selectedChoice();
    if (choice !== null) {
      this.agent.respondInput(item, choice);
    }
  }

  /**
   * Declines to answer a pending agent question; the agent is told and continues without an answer.
   * @param item The input-request item.
   */
  public skipInput(item: AgentItem): void {
    this.agent.respondInput(item, null);
  }

  /**
   * Reveals a clipped payload in full.
   * @param itemId The tool item's id.
   * @param section Which payload of the item to reveal.
   */
  public revealPayload(itemId: string, section: 'input' | 'output'): void {
    this.revealedPayloads.update((keys: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set<string>(keys);
      next.add(`${itemId}:${section}`);
      return next;
    });
  }

  /**
   * Builds the data URI for a transcript image thumbnail.
   * @param image The image.
   * @returns Returns the data URI.
   */
  public imageSrc(image: AiImageRef): string {
    return `data:${image.mediaType};base64,${image.data}`;
  }

  /**
   * Retries the conversation's final turn: rewinds to the last user message and resends it
   * unchanged, replacing the final reply with a fresh one (the original line stays in History).
   */
  public retryLast(): void {
    const target: { assistantId: string; user: AgentItem } | null = this.retryTarget();
    if (target !== null) {
      this.agent.rewind(target.user, target.user.text, this.tabId(), this.surface());
      this.atBottom.set(true);
    }
  }

  /**
   * Retries the failed turn an error item records.
   * @param item The error item.
   */
  public retry(item: AgentItem): void {
    this.agent.retry(item, this.tabId(), this.surface());
    // A fresh turn re-pins to the bottom even if the reader had scrolled up to read back.
    this.atBottom.set(true);
  }

  /**
   * Renders an error item's expandable diagnostics: the raw provider error, plus the failing tool's
   * context when a tool failure preceded the run's end. Empty when the cause line carries everything.
   * @param item The error item.
   * @returns Returns the diagnostics text.
   */
  public errorDiagnostics(item: AgentItem): string {
    const parts: string[] = [];
    if (item.errorDetail !== undefined) {
      parts.push(item.errorDetail);
    }
    if (item.errorToolContext !== undefined) {
      parts.push(`Failed tool — ${item.errorToolContext}`);
    }
    return parts.join('\n\n');
  }

  /**
   * Builds the remember-scope options for a pending permission card. The workspace option is only
   * offered when the asking run is workspace-scoped.
   * @param item The permission item.
   * @returns Returns the dropdown options.
   */
  public rememberOptions(item: AgentItem): readonly DropdownOption[] {
    return [
      { value: 'once', label: 'Just this once' },
      { value: 'session', label: 'For this session' },
      ...(item.permissionHasWorkspace === true
        ? [{ value: 'workspace', label: 'For this workspace' }]
        : []),
      { value: 'always', label: 'Always' },
    ];
  }

  /**
   * Records the remember scope picked on a pending permission card.
   * @param itemId The permission item's id.
   * @param scope The picked scope value.
   */
  public setRemember(itemId: string, scope: string): void {
    this.rememberChoice.update(
      (
        choices: Readonly<Record<string, string | undefined>>,
      ): Readonly<Record<string, string | undefined>> => ({
        ...choices,
        [itemId]: scope,
      }),
    );
  }

  /**
   * Answers a pending permission prompt, carrying the card's remember scope on a grant.
   * @param item The permission item.
   * @param granted Whether the user granted permission.
   */
  public respond(item: AgentItem, granted: boolean): void {
    const scope: string = this.rememberChoice()[item.id] ?? 'once';
    this.agent.respondPermission(
      item,
      granted,
      scope === 'session' || scope === 'workspace' || scope === 'always' ? scope : undefined,
    );
  }

  /**
   * Answers a pending edit-decision card.
   * @param item The edit-decision item.
   * @param choice The user's decision.
   */
  public decide(item: AgentItem, choice: AiEditDecision): void {
    this.agent.respondEditDecision(item, choice);
  }

  /**
   * Renders the settled state line of an edit-decision card.
   * @param item The edit-decision item.
   * @returns Returns the state label.
   */
  public decisionStateLabel(item: AgentItem): string {
    switch (item.decisionState) {
      case 'applied':
        return item.decisionAuto === true
          ? 'Applied · auto-accepting edits this session'
          : 'Applied';
      case 'rejected':
        return 'Rejected';
      default:
        return 'Not decided';
    }
  }

  /**
   * Renders the settled state line of a permission card, including the remembered scope on a grant.
   * @param item The permission item.
   * @returns Returns the state label.
   */
  public permissionStateLabel(item: AgentItem): string {
    if (item.permissionState === 'dismissed') {
      return 'Answered on another device';
    }
    if (item.permissionState !== 'allowed') {
      return 'Denied';
    }
    switch (item.permissionRemember) {
      case 'session':
        return 'Allowed for this session';
      case 'workspace':
        return 'Allowed for this workspace';
      case 'always':
        return 'Always allowed';
      default:
        return 'Allowed';
    }
  }

  /**
   * Opens links in agent output in the OS browser instead of navigating the app window.
   * @param event The click event.
   */
  @HostListener('click', ['$event'])
  public onClick(event: MouseEvent): void {
    const anchor: HTMLAnchorElement | null =
      event.target instanceof Element ? event.target.closest('a') : null;
    const href: string | undefined = anchor?.href;
    if (href === undefined || href.length === 0) {
      return;
    }
    event.preventDefault();
    void this.shell.openExternal(href);
  }
}
