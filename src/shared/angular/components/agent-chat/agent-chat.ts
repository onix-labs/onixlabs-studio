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
  signal,
  Signal,
  untracked,
  viewChild,
  WritableSignal,
} from '@angular/core';
import type { AgentContextRef, AgentSurface, AiEditDecision } from '@shared/api/ai-types';
import {
  Agent,
  AgentItem,
  AgentItemKind,
  AgentQueuedMessage,
  AgentToolState,
} from '@shared/angular/services/agent/agent';
import { formatCost, formatTokens } from '@shared/angular/services/agent/token-format';
import { AgentRequests } from '@shared/angular/services/agent-requests/agent-requests';
import { Shell } from '@shared/angular/services/shell/shell';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Modal } from '@shared/angular/components/modal/modal';
import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import { Radio } from '@shared/angular/components/forms/radio/radio';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { MarkdownPipe } from './markdown-pipe';
import { friendlyToolLabel, technicalToolName } from './tool-summary';

/**
 * How close (px) to the bottom of the message list still counts as "at the bottom" for follow-the-tail
 * scrolling, absorbing sub-pixel rounding and the last line's leading so streaming stays pinned.
 */
const BOTTOM_THRESHOLD_PX: number = 24;

/**
 * How many characters of a raw tool payload (full input or output) show before it is clipped behind
 * the "Show all" affordance. The full text is always present on the item; this only bounds what an
 * expanded tool row renders by default.
 */
const PAYLOAD_PREVIEW_CHARS: number = 1_500;

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
}

/**
 * A sub-agent's transcript entry prepared for rendering inside its lane: a tool call (label, input
 * summary, state) or a block of assistant text.
 */
interface LaneChild {
  /**
   * Gets the backing item's stable identity for tracking.
   */
  readonly id: string;

  /**
   * Gets whether this entry is a tool call or assistant text.
   */
  readonly kind: 'tool' | 'assistant';

  /**
   * Gets the friendly label of a tool entry.
   */
  readonly label?: string;

  /**
   * Gets the one-line input summary of a tool entry.
   */
  readonly detail?: string;

  /**
   * Gets the lifecycle state of a tool entry.
   */
  readonly state?: AgentToolState;

  /**
   * Gets the text of an assistant entry.
   */
  readonly text?: string;
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
   * Gets the sub-agent's own activity, rendered inside the expanded lane.
   */
  readonly children: readonly LaneChild[];
}

/**
 * An attached-context entry prepared for the composer's chip row: the reference plus the basename
 * shown on the chip.
 */
interface ContextChip {
  /**
   * Gets the attached file or folder's absolute path.
   */
  readonly path: string;

  /**
   * Gets the basename shown on the chip.
   */
  readonly name: string;

  /**
   * Gets whether the path is a file or a folder.
   */
  readonly kind: 'file' | 'folder';
}

/**
 * Renders one agent conversation as a structured, provider-agnostic transcript above a composer:
 * user/assistant turns (assistant text rendered as markdown), dim reasoning, tool-activity chips, and
 * inline permission prompts. It is a thin capability wrapper around the {@link Agent} session, which
 * the host provides (so the host's controls and history list share the same transcript); this
 * component owns no session controls, history, or persistence. Sending streams a live response; Stop
 * aborts it. Provider/model selection lives in the agent ribbon or tool strip, not the composer.
 * Links in agent output open in the OS browser rather than navigating the app.
 */
@Component({
  selector: 'app-agent-chat',
  imports: [AppIcon, Modal, MarkdownEditor, MarkdownPipe, NgTemplateOutlet, Radio, Dropdown],
  templateUrl: './agent-chat.html',
  styleUrl: './agent-chat.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentChat {
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
   * Gets the identifier of the tab hosting this conversation, or undefined when not hosted by a tab
   * (e.g. the dockable agent panel).
   */
  public readonly tabId: InputSignal<string | undefined> = input<string | undefined>(undefined);

  /**
   * Gets a value indicating whether the hosting tab is the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets what this conversation's runs act on, which selects the tool set the providers expose: the
   * open editor document (`editor`, the default) or the owning terminal (`terminal`).
   */
  public readonly surface: InputSignal<AgentSurface> = input<AgentSurface>('editor');

  /**
   * Gets a value indicating whether the transcript follows new content to the bottom as it streams,
   * the master preference the host drives from the agent ribbon's Auto-scroll check. When on, the
   * transcript is pinned to the newest content while the reader sits at the bottom; scrolling up pauses
   * the follow without changing the preference, and scrolling back to the bottom resumes it.
   */
  public readonly autoScroll: InputSignal<boolean> = input<boolean>(true);

  /**
   * Holds the current composer text.
   */
  private readonly draftText: WritableSignal<string> = signal<string>('');

  /**
   * Holds a value indicating whether the markdown composer modal is open.
   */
  protected readonly markdownOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the markdown the editor is seeded with each time the modal opens. It is set once on open
   * (from a cut-in plaintext draft, or empty) and only ever changes between opens, so binding it to
   * the editor's `content` never fights the editor's own live edits.
   */
  protected readonly markdownSeed: WritableSignal<string> = signal<string>('');

  /**
   * Holds the markdown editor's live content, updated as the user types, and read when the modal is
   * submitted or its content is returned to the plaintext composer on cancel.
   */
  protected readonly markdownValue: WritableSignal<string> = signal<string>('');

  /**
   * References the composer's text area, so its auto-grown height can be reset after a send.
   */
  private readonly inputRef: Signal<ElementRef<HTMLTextAreaElement> | undefined> =
    viewChild<ElementRef<HTMLTextAreaElement>>('input');

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
   * Gets the composer's live word count, labelled for the hint line.
   */
  protected readonly wordCount: Signal<string> = computed((): string =>
    this.wordCountOf(this.draftText()),
  );

  /**
   * Renders a labelled word count for a block of text (also the composer's counter and a thinking
   * disclosure's progress readout).
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
   * Gets a value indicating whether the conversation has reported any usage yet, so the composer's
   * context meter only appears once there is something to show.
   */
  protected readonly hasContext: Signal<boolean> = computed(
    (): boolean => this.agent.contextTokens() > 0,
  );

  /**
   * Gets the compact context-token figure for the composer meter (for example, `12.3k`).
   */
  protected readonly contextLabel: Signal<string> = computed((): string =>
    formatTokens(this.agent.contextTokens()),
  );

  /**
   * Gets how full the context window is, 0–100, for the meter fill; zero when the window is unknown.
   */
  protected readonly contextPercent: Signal<number> = computed((): number => {
    const window: number = this.agent.contextWindow();
    return window > 0 ? Math.min(100, Math.round((this.agent.contextTokens() / window) * 100)) : 0;
  });

  /**
   * Gets the meter's fill level, driving its colour so a near-full context is a visible cue to
   * compact: `ok` below 75%, `warn` from 75%, `high` from 90%.
   */
  protected readonly contextLevel: Signal<'ok' | 'warn' | 'high'> = computed(
    (): 'ok' | 'warn' | 'high' => {
      const percent: number = this.contextPercent();
      return percent >= 90 ? 'high' : percent >= 75 ? 'warn' : 'ok';
    },
  );

  /**
   * Gets the full tooltip for the context meter: used and total tokens, the percentage, and the
   * accumulated cost when the provider reports one.
   */
  protected readonly contextTitle: Signal<string> = computed((): string => {
    const used: string = this.agent.contextTokens().toLocaleString();
    const window: number = this.agent.contextWindow();
    const base: string =
      window > 0
        ? `${used} / ${window.toLocaleString()} tokens (${this.contextPercent()}%)`
        : `${used} tokens`;
    const cost: number = this.agent.costUsd();
    return cost > 0 ? `${base} · ${formatCost(cost)}` : base;
  });

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
   * Gets the question the agent is currently waiting on, or undefined when none is pending. While one
   * is pending the composer switches into answer mode: the draft is sent as the answer rather than as
   * a new message.
   */
  public readonly pendingInput: Signal<AgentItem | undefined> = this.agent.pendingInput;

  /**
   * Gets the messages queued while a run executes, listed above the composer until they dispatch.
   */
  public readonly queue: Signal<readonly AgentQueuedMessage[]> = this.agent.queued;

  /**
   * Holds the prior user message being edited for resend (the composer's edit mode), or null when
   * composing normally. Sending in edit mode rewinds the conversation to that message.
   */
  protected readonly editing: WritableSignal<AgentItem | null> = signal<AgentItem | null>(null);

  /**
   * Holds the draft that was in the composer when edit mode began, restored on cancel.
   */
  private stashedBeforeEdit: string = '';

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
   * Holds the label of the suggested choice currently selected on the pending question's radio group,
   * or null when none is selected yet. Reset whenever the pending question changes.
   */
  protected readonly selectedChoice: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the remember scope selected on each pending permission card, keyed by item id ('once' when
   * unset). Parallel sub-agents can raise concurrent prompts, so the selection is per card.
   */
  protected readonly rememberChoice: WritableSignal<Readonly<Record<string, string>>> = signal<
    Readonly<Record<string, string>>
  >({});

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
   * Holds the position in the sent-prompt history while the user arrows through it from the composer
   * (0 = the most recent prompt), or null when not navigating.
   */
  private historyIndex: number | null = null;

  /**
   * Holds the draft that was in the composer when history navigation began, restored when the user
   * arrows back past the most recent prompt.
   */
  private stashedDraft: string = '';

  /**
   * Gets the current composer text.
   */
  public readonly draft: Signal<string> = this.draftText.asReadonly();

  /**
   * Gets the attached context prepared for the composer's chip row.
   */
  public readonly attachments: Signal<readonly ContextChip[]> = computed(
    (): readonly ContextChip[] =>
      this.agent.contextPaths().map(
        (ref: AgentContextRef): ContextChip => ({
          path: ref.path,
          name: this.baseName(ref.path),
          kind: ref.kind,
        }),
      ),
  );

  /**
   * Gets the transcript prepared for rendering: each item plus the live working indicator, tagged with
   * timeline-rail connectivity and, for tool rows, a friendly label and technical name. The agent's
   * own activity (assistant text, reasoning, tool calls, and the working indicator) forms one
   * connected rail; the user's messages and permission prompts sit off it and break the line.
   */
  protected readonly rows: Signal<readonly TranscriptRow[]> = computed(
    (): readonly TranscriptRow[] => {
      const items: readonly AgentItem[] = this.items();
      const showWorking: boolean = this.isRunning() && !this.awaitingDecision();
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
      // A thinking row is live while the run is still producing it (it is the newest item); it
      // streams into its disclosure and its collapsed summary reads as progress.
      const lastItemId: string | undefined = items[items.length - 1]?.id;
      const thinking: (entry: RailEntry) => boolean = (entry: RailEntry): boolean =>
        entry.kind === 'thinking';
      const thinkingLive: (entry: RailEntry) => boolean = (entry: RailEntry): boolean =>
        thinking(entry) && this.isRunning() && entry.item?.id === lastItemId;

      const onRail: (kind: TranscriptRowKind) => boolean = (kind: TranscriptRowKind): boolean =>
        kind === 'assistant' || kind === 'thinking' || kind === 'tool' || kind === 'working';

      const running: (entry: RailEntry) => boolean = (entry: RailEntry): boolean =>
        entry.kind === 'tool' && entry.item?.toolState === 'running';

      const nodeIconFor: (entry: RailEntry) => Icon = (entry: RailEntry): Icon => {
        switch (entry.kind) {
          case 'assistant':
            return Icon.AGENT;
          case 'thinking':
            return thinkingLive(entry) ? Icon.SPINNER : Icon.THINKING;
          case 'working':
            return Icon.SPINNER;
          case 'tool':
            if (entry.item?.toolState === 'running') {
              return Icon.SPINNER;
            }
            return entry.item?.toolState === 'error' ? Icon.WARNING : Icon.ACTION;
          default:
            return Icon.ACTION;
        }
      };

      return sequence.map((row: RailEntry, index: number): TranscriptRow => {
        const timeline: boolean = onRail(row.kind);
        const previous: RailEntry | undefined = sequence[index - 1];
        const next: RailEntry | undefined = sequence[index + 1];
        const lane: LaneInfo | undefined =
          row.kind === 'tool' && row.item !== null
            ? this.laneFor(row.item, children.get(row.item.toolId ?? ''))
            : undefined;
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
          meta: thinking(row) ? this.wordCountOf(row.item?.text ?? '') : undefined,
          tech: row.kind === 'tool' ? technicalToolName(row.item?.toolName) : undefined,
          lane,
        };
      });
    },
  );

  /**
   * Prepares a Task tool item for rendering as a sub-agent lane, or returns undefined for an
   * ordinary tool row (no sub-agent type and no nested activity).
   * @param item The tool item.
   * @param kids The items attributed to this tool use, or undefined for none.
   * @returns Returns the lane, or undefined.
   */
  private laneFor(item: AgentItem, kids: readonly AgentItem[] | undefined): LaneInfo | undefined {
    const nested: readonly AgentItem[] = (kids ?? []).filter(
      (kid: AgentItem): boolean => kid.kind !== 'thinking',
    );
    if (item.agentType === undefined && nested.length === 0) {
      return undefined;
    }
    const tools: readonly AgentItem[] = nested.filter(
      (kid: AgentItem): boolean => kid.kind === 'tool',
    );
    const active: AgentItem | undefined = [...tools]
      .reverse()
      .find((tool: AgentItem): boolean => tool.toolState === 'running');
    const status: string =
      item.toolState === 'running'
        ? `${active !== undefined ? friendlyToolLabel(active.toolName) : 'Working'}…`
        : item.toolState === 'error'
          ? 'failed'
          : 'done';
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
      children: nested.map(
        (kid: AgentItem): LaneChild =>
          kid.kind === 'tool'
            ? {
                id: kid.id,
                kind: 'tool',
                label: friendlyToolLabel(kid.toolName),
                detail: kid.toolDetail,
                state: kid.toolState,
              }
            : { id: kid.id, kind: 'assistant', text: kid.text },
      ),
    };
  }

  /**
   * Initializes a new instance of the {@link AgentChat} class, lighting the hosting tab's attention dot
   * while the conversation awaits a permission decision in the background.
   */
  public constructor() {
    // Report this conversation's pending requests to the app-wide registry (the title strip's
    // agent-requests bell), attributed to the hosting tab when there is one.
    const unregister: () => void = this.requests.register({
      agent: this.agent,
      tabId: (): string | null => this.tabId() ?? null,
      label: (): string => {
        const id: string | undefined = this.tabId();
        if (id !== undefined) {
          return this.tabs.tabs().find((tab: Tab): boolean => tab.id === id)?.title ?? 'Agent';
        }
        return 'Agent panel';
      },
    });
    inject(DestroyRef).onDestroy(unregister);

    effect((): void => {
      const id: string | undefined = this.tabId();
      const waiting: boolean = this.awaitingDecision();
      const active: boolean = this.isActive();
      untracked((): void => {
        if (id !== undefined) {
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

    // Follow the tail: after each render that grows the transcript (streamed text, a new row, or the
    // working indicator), pin the list to the bottom while the preference is on and the reader is
    // already there. Reading rows() re-runs this as the transcript streams.
    afterRenderEffect((): void => {
      this.rows();
      if (!this.autoScroll() || !this.atBottom()) {
        return;
      }
      const element: HTMLElement | undefined = this.messagesRef()?.nativeElement;
      if (element !== undefined) {
        element.scrollTop = element.scrollHeight;
      }
    });
  }

  /**
   * Records whether the reader is at the bottom of the message list as they scroll, which gates
   * follow-the-tail pinning. A programmatic pin lands at the bottom and keeps this true; scrolling up
   * clears it and pauses the follow until the reader returns to the bottom.
   * @param element The scrolling message list.
   */
  public onScroll(element: HTMLElement): void {
    const distance: number = element.scrollHeight - element.scrollTop - element.clientHeight;
    this.atBottom.set(distance <= BOTTOM_THRESHOLD_PX);
  }

  /**
   * Records composer input. Typing ends any prompt-history navigation, so the next ArrowUp starts
   * again from the most recent prompt.
   * @param value The new composer text.
   */
  public onInput(value: string): void {
    this.draftText.set(value);
    this.historyIndex = null;
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
   * Sends the current draft: as the answer to a pending agent question when one is waiting (the
   * composer's answer mode), as a rewind-and-resend while a prior message is being edited (edit
   * mode), otherwise as a new message starting a run. Blank drafts are ignored.
   */
  public send(): void {
    const text: string = this.draftText();
    if (text.trim().length === 0) {
      return;
    }
    const pending: AgentItem | undefined = this.pendingInput();
    const editing: AgentItem | null = this.editing();
    if (pending !== undefined) {
      this.agent.respondInput(pending, text.trim());
    } else if (editing !== null) {
      this.editing.set(null);
      this.stashedBeforeEdit = '';
      this.agent.rewind(editing, text, this.tabId(), this.surface());
    } else {
      this.agent.send(text, this.tabId(), this.surface());
    }
    this.draftText.set('');
    this.historyIndex = null;
    // A fresh turn re-pins to the bottom even if the reader had scrolled up to read back.
    this.atBottom.set(true);
    // Collapse the auto-grown text area back to a single row now that it is empty.
    const element: HTMLTextAreaElement | undefined = this.inputRef()?.nativeElement;
    if (element !== undefined) {
      element.style.height = 'auto';
    }
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
   * Renders a raw tool payload for an expanded tool row: the full text once revealed (or when it is
   * short), otherwise its preview clip.
   * @param itemId The tool item's id.
   * @param section Which payload of the item this is.
   * @param text The full payload text.
   * @returns Returns the text to render.
   */
  public payloadText(itemId: string, section: 'input' | 'output', text: string): string {
    return this.payloadClipped(itemId, section, text) ? text.slice(0, PAYLOAD_PREVIEW_CHARS) : text;
  }

  /**
   * Gets a value indicating whether a raw tool payload is currently clipped to its preview (long and
   * not yet revealed), which shows the "Show all" affordance.
   * @param itemId The tool item's id.
   * @param section Which payload of the item this is.
   * @param text The full payload text.
   * @returns Returns true when the payload renders clipped.
   */
  public payloadClipped(itemId: string, section: 'input' | 'output', text: string): boolean {
    return (
      text.length > PAYLOAD_PREVIEW_CHARS && !this.revealedPayloads().has(`${itemId}:${section}`)
    );
  }

  /**
   * Renders the "Show all" label for a clipped payload, saying how much is hidden.
   * @param text The full payload text.
   * @returns Returns the label.
   */
  public payloadMoreLabel(text: string): string {
    return `Show all (${(text.length - PAYLOAD_PREVIEW_CHARS).toLocaleString()} more characters)`;
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
   * Opens the markdown composer modal. A plaintext draft already in the composer is cut into the
   * editor so the user can keep building on it in markdown; otherwise the editor starts blank.
   */
  public openMarkdown(): void {
    const existing: string = this.draftText();
    if (existing.trim().length > 0) {
      this.markdownSeed.set(existing);
      this.markdownValue.set(existing);
      this.draftText.set('');
      const element: HTMLTextAreaElement | undefined = this.inputRef()?.nativeElement;
      if (element !== undefined) {
        element.style.height = 'auto';
      }
    } else {
      this.markdownSeed.set('');
      this.markdownValue.set('');
    }
    this.markdownOpen.set(true);
  }

  /**
   * Records the markdown editor's live content.
   * @param markdown The current editor markdown.
   */
  public onMarkdownChange(markdown: string): void {
    this.markdownValue.set(markdown);
  }

  /**
   * Sends the markdown composed in the modal straight to the agent and closes the modal. The sent
   * text appears in the transcript as the user's turn. Blank content and in-flight runs are ignored.
   */
  public submitMarkdown(): void {
    const text: string = this.markdownValue();
    if (text.trim().length === 0 || this.isRunning()) {
      return;
    }
    this.agent.send(text, this.tabId(), this.surface());
    // A fresh turn re-pins to the bottom even if the reader had scrolled up to read back.
    this.atBottom.set(true);
    this.markdownOpen.set(false);
    this.markdownSeed.set('');
    this.markdownValue.set('');
  }

  /**
   * Closes the markdown composer modal without sending. Any content the user had written is returned
   * to the plaintext composer so nothing is lost, especially a draft that was cut in when it opened.
   */
  public cancelMarkdown(): void {
    const text: string = this.markdownValue();
    this.markdownOpen.set(false);
    this.markdownSeed.set('');
    this.markdownValue.set('');
    if (text.trim().length > 0) {
      this.draftText.set(text);
    }
  }

  /**
   * Grows the composer's text area to fit its content, so a multi-line prompt is fully visible up to
   * the area's maximum height, past which it scrolls.
   * @param element The text area element.
   */
  public autoGrow(element: HTMLTextAreaElement): void {
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }

  /**
   * Stops the in-flight run.
   */
  public stop(): void {
    this.agent.stop();
  }

  /**
   * Removes a queued message before it dispatches.
   * @param id The queued entry's identifier.
   */
  public removeQueued(id: string): void {
    this.agent.removeQueued(id);
  }

  /**
   * Loads a queued message back into the composer for editing, removing it from the queue.
   * @param entry The queued entry.
   */
  public editQueued(entry: AgentQueuedMessage): void {
    const text: string | null = this.agent.takeQueued(entry.id);
    if (text === null) {
      return;
    }
    this.draftText.set(text);
    const area: HTMLTextAreaElement | undefined = this.inputRef()?.nativeElement;
    if (area !== undefined) {
      area.value = text;
      this.autoGrow(area);
      area.focus();
    }
  }

  /**
   * Enters edit mode on a prior user message: its text is loaded into the composer and sending
   * rewinds the conversation to that message. The draft being written is stashed and restored on
   * cancel.
   * @param item The user item to edit and resend.
   */
  public beginEdit(item: AgentItem): void {
    this.stashedBeforeEdit = this.draftText();
    this.editing.set(item);
    this.draftText.set(item.text);
    const area: HTMLTextAreaElement | undefined = this.inputRef()?.nativeElement;
    if (area !== undefined) {
      area.value = item.text;
      this.autoGrow(area);
      area.focus();
    }
  }

  /**
   * Leaves edit mode without resending, restoring the stashed draft.
   */
  public cancelEdit(): void {
    if (this.editing() === null) {
      return;
    }
    this.editing.set(null);
    this.draftText.set(this.stashedBeforeEdit);
    const area: HTMLTextAreaElement | undefined = this.inputRef()?.nativeElement;
    if (area !== undefined) {
      area.value = this.stashedBeforeEdit;
      this.autoGrow(area);
    }
    this.stashedBeforeEdit = '';
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
   * Removes an attached file or folder from the conversation's context.
   * @param path The path to detach.
   */
  public removeContext(path: string): void {
    this.agent.removeContext(path);
  }

  /**
   * Gets the trailing path segment of a file or folder path, for a chip's label.
   * @param path The absolute path.
   * @returns Returns the basename.
   */
  private baseName(path: string): string {
    const segments: string[] = path
      .split(/[\\/]/)
      .filter((segment: string): boolean => segment.length > 0);
    return segments[segments.length - 1] ?? path;
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
      (choices: Readonly<Record<string, string>>): Readonly<Record<string, string>> => ({
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
   * Handles composer key presses: sends on Enter (Shift+Enter inserts a newline), and recalls the
   * sent-prompt history on ArrowUp/ArrowDown.
   * @param event The keyboard event.
   */
  public onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.editing() !== null) {
      event.preventDefault();
      this.cancelEdit();
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      this.onHistoryKey(event);
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    event.preventDefault();
    this.send();
  }

  /**
   * Recalls previously sent prompts into the composer, shell-style: ArrowUp steps to older prompts,
   * ArrowDown back to newer ones, and stepping past the most recent restores whatever draft was
   * being written when navigation began. Only engages while the caret is on the first (Up) or last
   * (Down) line, so the arrows still move the caret inside a multi-line draft.
   * @param event The keyboard event (its target is the composer text area).
   */
  private onHistoryKey(event: KeyboardEvent): void {
    const area: HTMLTextAreaElement = event.target as HTMLTextAreaElement;
    const history: readonly string[] = this.items()
      .filter((item: AgentItem): boolean => item.kind === 'user')
      .map((item: AgentItem): string => item.text);
    if (history.length === 0) {
      return;
    }
    const caretStart: number = area.selectionStart ?? 0;
    const caretEnd: number = area.selectionEnd ?? caretStart;
    if (event.key === 'ArrowUp') {
      if (area.value.slice(0, caretStart).includes('\n')) {
        return;
      }
      const next: number = this.historyIndex === null ? 0 : this.historyIndex + 1;
      if (next >= history.length) {
        return;
      }
      if (this.historyIndex === null) {
        this.stashedDraft = area.value;
      }
      this.historyIndex = next;
      event.preventDefault();
      this.recall(area, history[history.length - 1 - next]);
    } else {
      if (this.historyIndex === null || area.value.slice(caretEnd).includes('\n')) {
        return;
      }
      event.preventDefault();
      if (this.historyIndex === 0) {
        this.historyIndex = null;
        this.recall(area, this.stashedDraft);
      } else {
        this.historyIndex -= 1;
        this.recall(area, history[history.length - 1 - this.historyIndex]);
      }
    }
  }

  /**
   * Puts a recalled prompt into the composer: the text area is set directly (so the caret and height
   * update deterministically) and the draft signal keeps the binding in agreement.
   * @param area The composer text area.
   * @param text The recalled text.
   */
  private recall(area: HTMLTextAreaElement, text: string): void {
    area.value = text;
    this.draftText.set(text);
    area.setSelectionRange(text.length, text.length);
    this.autoGrow(area);
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
