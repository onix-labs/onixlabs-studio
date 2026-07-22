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
import type {
  AgentContextRef,
  AgentSurface,
  AiEditDecision,
  AiEffort,
  AiImageRef,
  AiProviderInfo,
} from '@shared/api/ai-types';
import {
  Agent,
  AgentItem,
  AgentItemKind,
  AgentQueuedMessage,
  AgentToolState,
} from '@shared/angular/services/agent/agent';
import { AgentEngine } from '@shared/angular/services/agent-engine/agent-engine';
import { AgentPrompt, AgentPrompts } from '@shared/angular/services/agent-prompts/agent-prompts';
import { formatCost, formatTokens } from '@shared/angular/services/agent/token-format';
import { Search } from '@shared/angular/services/search/search';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { AgentRequests } from '@shared/angular/services/agent-requests/agent-requests';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { AgentHosts } from '@shared/angular/services/agent-hosts/agent-hosts';
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
 * The most images a single turn can carry.
 */
const MAX_IMAGES: number = 4;

/**
 * The largest accepted image file (bytes). Base64 inflates this by ~4/3 on the wire and in the
 * persisted transcript, and the main process backstops at a slightly larger cap.
 */
const MAX_IMAGE_BYTES: number = 4 * 1024 * 1024;

/**
 * The image media types accepted by the composer (the types the providers accept).
 */
const IMAGE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/**
 * The most rows the composer's suggestion popup shows at once.
 */
const MAX_SUGGESTIONS: number = 8;

/**
 * An entry in the composer's suggestion popup: a built-in slash command, a library prompt, a
 * workspace file for an `@`-mention, or the manage-prompts affordance.
 */
interface ComposerSuggestion {
  /**
   * Gets what accepting the entry does.
   */
  readonly kind: 'command' | 'prompt' | 'mention' | 'manage';

  /**
   * Gets the row's primary label (`/compact`, a relative path, …).
   */
  readonly label: string;

  /**
   * Gets the row's muted description.
   */
  readonly hint: string;

  /**
   * Gets the value accepting the entry acts with (command name, prompt id, or relative path).
   */
  readonly value: string;
}

/**
 * The token the suggestion popup is anchored to: the trigger character, the query typed after it,
 * and where the token starts in the draft.
 */
interface SuggestToken {
  /**
   * Gets the trigger character.
   */
  readonly trigger: '/' | '@';

  /**
   * Gets the query typed after the trigger.
   */
  readonly query: string;

  /**
   * Gets the index of the trigger character in the draft.
   */
  readonly start: number;
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
   * Gets whether the reference is a file, a folder, or an editor selection.
   */
  readonly kind: 'file' | 'folder' | 'selection';
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
   * Holds the global engine selection, read to gate image input on the selected provider's support.
   */
  private readonly agentEngine: AgentEngine = inject(AgentEngine);

  /**
   * Holds the user's reusable-prompt library, offered by the `/` popup.
   */
  private readonly promptLibrary: AgentPrompts = inject(AgentPrompts);

  /**
   * Holds the search client, the source of the workspace file list for `@`-mentions.
   */
  private readonly search: Search = inject(Search);

  /**
   * Holds the workspace, whose root scopes the `@`-mention file list.
   */
  private readonly workspaceService: Workspace = inject(Workspace);

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
   * Gets a value indicating whether this chat is a mirror of another host's conversation (a Mission
   * Control tile). A mirror drives the shared session but does not register as its own host, report its
   * pending requests again, or light the tab's attention dot — the origin already does.
   */
  public readonly mirror: InputSignal<boolean> = input<boolean>(false);

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
   * Gets a value indicating whether the composer's context meter has anything to show: reported
   * usage, or an estimate for attached-but-unsent context.
   */
  protected readonly hasContext: Signal<boolean> = computed(
    (): boolean => this.agent.contextTokens() > 0 || this.agent.pendingContextTokens() > 0,
  );

  /**
   * Gets the tokens the meter reflects: the reported usage plus the estimated cost of attached
   * context that has not been sent yet (inlined selections).
   */
  private readonly meterTokens: Signal<number> = computed(
    (): number => this.agent.contextTokens() + this.agent.pendingContextTokens(),
  );

  /**
   * Gets the compact context-token figure for the composer meter (for example, `12.3k`), prefixed
   * with `≈` while it includes an attached-context estimate.
   */
  protected readonly contextLabel: Signal<string> = computed((): string => {
    const label: string = formatTokens(this.meterTokens());
    return this.agent.pendingContextTokens() > 0 ? `≈${label}` : label;
  });

  /**
   * Gets how full the context window is, 0–100, for the meter fill; zero when the window is unknown.
   */
  protected readonly contextPercent: Signal<number> = computed((): number => {
    const window: number = this.agent.contextWindow();
    return window > 0 ? Math.min(100, Math.round((this.meterTokens() / window) * 100)) : 0;
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
    const used: string = this.meterTokens().toLocaleString();
    const window: number = this.agent.contextWindow();
    let base: string =
      window > 0
        ? `${used} / ${window.toLocaleString()} tokens (${this.contextPercent()}%)`
        : `${used} tokens`;
    const pending: number = this.agent.pendingContextTokens();
    if (pending > 0) {
      base = `${base} · includes ≈${pending.toLocaleString()} tokens of attached selection`;
    }
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
   * Holds the images attached to the draft (pasted or dropped), shown as thumbnail chips and sent
   * with the next message.
   */
  protected readonly pendingImages: WritableSignal<readonly AiImageRef[]> = signal<
    readonly AiImageRef[]
  >([]);

  /**
   * Holds the transient image-input hint (unsupported provider, oversize file, …), or null.
   */
  protected readonly imageHint: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the milliseconds the current run has been actively executing. Ticks only while the run is
   * not blocked on the user, mirroring the wall-clock budget's pause semantics; reset when a run
   * starts.
   */
  protected readonly elapsedMs: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the ticking interval behind {@link elapsedMs}, or null while no run executes.
   */
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Gets the elapsed-run readout (`m:ss`), shown beside the token meter while a run executes.
   */
  protected readonly elapsedLabel: Signal<string> = computed((): string => {
    const total: number = Math.floor(this.elapsedMs() / 1000);
    const minutes: number = Math.floor(total / 60);
    const seconds: number = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  });

  /**
   * Holds the token the suggestion popup is anchored to, or null while no popup is open.
   */
  private readonly suggestToken: WritableSignal<SuggestToken | null> = signal<SuggestToken | null>(
    null,
  );

  /**
   * Holds the index of the highlighted suggestion row.
   */
  protected readonly suggestIndex: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the workspace file list backing `@`-mentions (gitignore-aware relative paths), refreshed
   * when the mention popup opens.
   */
  private readonly workspaceFiles: WritableSignal<readonly string[]> = signal<readonly string[]>(
    [],
  );

  /**
   * Holds a value indicating whether the manage-prompts modal is open.
   */
  protected readonly managePromptsOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the manage-prompts modal's name field.
   */
  protected readonly newPromptName: WritableSignal<string> = signal<string>('');

  /**
   * Holds the manage-prompts modal's text field.
   */
  protected readonly newPromptText: WritableSignal<string> = signal<string>('');

  /**
   * Gets the user's reusable prompts, for the manage-prompts modal.
   */
  protected readonly libraryPrompts: Signal<readonly AgentPrompt[]> = this.promptLibrary.prompts;

  /**
   * Gets the rows of the composer's suggestion popup: for `/`, the built-in commands and library
   * prompts matching the query plus the manage affordance; for `@`, the workspace files matching the
   * query. Empty while no popup is open.
   */
  protected readonly suggestions: Signal<readonly ComposerSuggestion[]> = computed(
    (): readonly ComposerSuggestion[] => {
      const token: SuggestToken | null = this.suggestToken();
      if (token === null) {
        return [];
      }
      if (token.trigger === '@') {
        return this.filterFiles(token.query).map(
          (path: string): ComposerSuggestion => ({
            kind: 'mention',
            label: path,
            hint: 'Attach file',
            value: path,
          }),
        );
      }
      const query: string = token.query.toLowerCase();
      const builtins: readonly ComposerSuggestion[] = [
        {
          kind: 'command',
          label: '/compact',
          hint: 'Summarise the conversation',
          value: 'compact',
        },
        { kind: 'command', label: '/clear', hint: 'Start a new conversation', value: 'clear' },
        { kind: 'command', label: '/mode', hint: 'Toggle Agent / Chat mode', value: 'mode' },
        ...this.effortSuggestions(),
      ];
      const commands: ComposerSuggestion[] = builtins.filter(
        (entry: ComposerSuggestion): boolean => entry.value.startsWith(query) || query.length === 0,
      );
      const prompts: ComposerSuggestion[] = this.promptLibrary
        .prompts()
        .filter((prompt: AgentPrompt): boolean => prompt.name.includes(query))
        .map(
          (prompt: AgentPrompt): ComposerSuggestion => ({
            kind: 'prompt',
            label: `/${prompt.name}`,
            hint: prompt.text.length > 60 ? `${prompt.text.slice(0, 57)}…` : prompt.text,
            value: prompt.id,
          }),
        );
      return [
        ...commands,
        ...prompts.slice(0, MAX_SUGGESTIONS),
        {
          kind: 'manage',
          label: 'Manage prompts…',
          hint: 'Add or remove reusable prompts',
          value: '',
        },
      ];
    },
  );

  /**
   * Holds the timer that clears the transient image hint, or null when none is pending.
   */
  private imageHintTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Gets a value indicating whether the selected provider accepts image input, so the composer can
   * reject images at compose time rather than at run time.
   */
  protected readonly supportsImages: Signal<boolean> = computed(
    (): boolean =>
      this.agentEngine
        .providers()
        .find((info: AiProviderInfo): boolean => info.id === this.agentEngine.provider())
        ?.supportsImages === true,
  );

  /**
   * Gets the reasoning-effort levels the selected provider offers (#330), least to most, so the
   * `/effort` command gates and offers the right levels. Empty when the provider has no selectable
   * effort.
   */
  protected readonly supportedEfforts: Signal<readonly AiEffort[]> = computed(
    (): readonly AiEffort[] =>
      this.agentEngine
        .providers()
        .find((info: AiProviderInfo): boolean => info.id === this.agentEngine.provider())
        ?.supportedEfforts ?? [],
  );

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

    // The elapsed indicator ticks while a run executes, pausing whenever the run is blocked on the
    // user — mirroring the wall-clock budget's pause semantics.
    effect((): void => {
      const running: boolean = this.isRunning();
      untracked((): void => {
        if (running) {
          this.elapsedMs.set(0);
          this.elapsedTimer ??= setInterval((): void => {
            if (!this.awaitingDecision()) {
              this.elapsedMs.update((value: number): number => value + 1000);
            }
          }, 1000);
        } else if (this.elapsedTimer !== null) {
          clearInterval(this.elapsedTimer);
          this.elapsedTimer = null;
        }
      });
    });
    inject(DestroyRef).onDestroy((): void => {
      if (this.elapsedTimer !== null) {
        clearInterval(this.elapsedTimer);
      }
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
      this.agent.send(text, this.tabId(), this.surface(), this.pendingImages());
      this.pendingImages.set([]);
    }
    this.suggestToken.set(null);
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
   * Re-anchors the suggestion popup after composer input: a `/` starting the draft opens the
   * command/prompt popup, a `@` token opens the workspace-file mention popup, and anything else
   * closes it. Called on every input alongside {@link onInput}.
   * @param area The composer text area (its caret position anchors the token scan).
   */
  public updateSuggest(area: HTMLTextAreaElement): void {
    const caret: number = area.selectionStart ?? area.value.length;
    const value: string = area.value;
    // Scan back from the caret to the token start (whitespace boundary).
    let start: number = caret;
    while (start > 0 && !/\s/.test(value[start - 1])) {
      start -= 1;
    }
    const token: string = value.slice(start, caret);
    const previous: SuggestToken | null = this.suggestToken();
    let next: SuggestToken | null = null;
    if (token.startsWith('/') && start === 0) {
      next = { trigger: '/', query: token.slice(1), start };
    } else if (token.startsWith('@') && token.length >= 1) {
      next = { trigger: '@', query: token.slice(1), start };
    }
    this.suggestToken.set(next);
    if (next === null) {
      return;
    }
    if (previous?.trigger !== next.trigger || previous.start !== next.start) {
      this.suggestIndex.set(0);
    } else {
      // Keep the highlight in range as the query narrows the list.
      this.suggestIndex.update((index: number): number =>
        Math.min(index, Math.max(0, this.suggestions().length - 1)),
      );
    }
    if (next.trigger === '@') {
      void this.loadWorkspaceFiles();
    }
  }

  /**
   * Loads the workspace file list backing `@`-mentions (a no-op without a workspace; refreshed once
   * per popup opening).
   */
  private async loadWorkspaceFiles(): Promise<void> {
    const root: string | undefined = this.workspaceService.root()?.path;
    if (root === undefined || this.workspaceFiles().length > 0) {
      return;
    }
    this.workspaceFiles.set(await this.search.listFiles(root));
  }

  /**
   * Filters the workspace files against a mention query: basename prefix matches rank first, then
   * basename substrings, then path substrings, shortest path first within a rank.
   * @param query The typed query.
   * @returns Returns the top matches.
   */
  private filterFiles(query: string): readonly string[] {
    const files: readonly string[] = this.workspaceFiles();
    const lower: string = query.toLowerCase();
    if (lower.length === 0) {
      return files.slice(0, MAX_SUGGESTIONS);
    }
    const scored: { path: string; score: number }[] = [];
    for (const path of files) {
      const lowerPath: string = path.toLowerCase();
      const base: string = lowerPath.slice(lowerPath.lastIndexOf('/') + 1);
      const score: number = base.startsWith(lower)
        ? 0
        : base.includes(lower)
          ? 1
          : lowerPath.includes(lower)
            ? 2
            : -1;
      if (score >= 0) {
        scored.push({ path, score });
      }
    }
    scored.sort(
      (a: { path: string; score: number }, b: { path: string; score: number }): number =>
        a.score - b.score || a.path.length - b.path.length,
    );
    return scored.slice(0, MAX_SUGGESTIONS).map((entry: { path: string }): string => entry.path);
  }

  /**
   * Gets the glyph for a suggestion row.
   * @param option The suggestion.
   * @returns Returns the icon.
   */
  protected suggestIcon(option: ComposerSuggestion): Icon {
    switch (option.kind) {
      case 'command':
        return Icon.ACTION;
      case 'prompt':
        return Icon.SPARKLE;
      case 'manage':
        return Icon.SETTINGS;
      default:
        return Icon.FILE;
    }
  }

  /**
   * Accepts a suggestion: a built-in command executes, a library prompt's text replaces the token, a
   * mention attaches the file and leaves a readable `@basename` in the draft, and the manage entry
   * opens the prompt-library modal.
   * @param option The accepted suggestion.
   */
  public acceptSuggestion(option: ComposerSuggestion): void {
    const token: SuggestToken | null = this.suggestToken();
    if (token === null) {
      return;
    }
    const end: number = token.start + 1 + token.query.length;
    if (option.kind === 'command') {
      this.replaceComposerRange(token.start, end, '');
      this.runCommand(option.value);
    } else if (option.kind === 'prompt') {
      const prompt: AgentPrompt | undefined = this.promptLibrary
        .prompts()
        .find((candidate: AgentPrompt): boolean => candidate.id === option.value);
      this.replaceComposerRange(token.start, end, prompt?.text ?? '');
    } else if (option.kind === 'mention') {
      const base: string = option.value.slice(option.value.lastIndexOf('/') + 1);
      this.replaceComposerRange(token.start, end, `@${base} `);
      const root: string | undefined = this.workspaceService.root()?.path;
      if (root !== undefined) {
        this.agent.attachContext({ path: `${root}/${option.value}`, kind: 'file' });
      }
    } else {
      this.replaceComposerRange(token.start, end, '');
      this.managePromptsOpen.set(true);
    }
    this.suggestToken.set(null);
  }

  /**
   * Builds the `/effort` command entries for the selected provider (#330): one per supported level plus
   * a "default" entry, with the active choice marked. Empty when the provider offers no effort control,
   * so the command is hidden for those providers.
   * @returns Returns the effort command suggestions.
   */
  private effortSuggestions(): readonly ComposerSuggestion[] {
    const levels: readonly AiEffort[] = this.supportedEfforts();
    if (levels.length === 0) {
      return [];
    }
    const current: AiEffort | null = this.agent.effort();
    const entries: ComposerSuggestion[] = levels.map(
      (level: AiEffort): ComposerSuggestion => ({
        kind: 'command',
        label: `/effort ${level}`,
        hint: level === current ? 'Reasoning effort (current)' : 'Set reasoning effort',
        value: `effort:${level}`,
      }),
    );
    entries.push({
      kind: 'command',
      label: '/effort default',
      hint: current === null ? 'Provider default (current)' : 'Use the provider default',
      value: 'effort:default',
    });
    return entries;
  }

  /**
   * Runs a built-in slash command against the conversation.
   * @param command The command name.
   */
  private runCommand(command: string): void {
    if (command === 'compact') {
      this.agent.compact();
    } else if (command === 'clear') {
      this.agent.clear();
    } else if (command === 'mode') {
      this.agent.setMode(this.agent.mode() === 'chat' ? 'agent' : 'chat');
    } else if (command.startsWith('effort:')) {
      const level: string = command.slice('effort:'.length);
      this.agent.setEffort(level === 'default' ? null : (level as AiEffort));
    }
  }

  /**
   * Replaces a range of the composer draft, syncing the text area, caret, and height.
   * @param start The first character of the range.
   * @param end The character after the range.
   * @param text The replacement text.
   */
  private replaceComposerRange(start: number, end: number, text: string): void {
    const current: string = this.draftText();
    const next: string = current.slice(0, start) + text + current.slice(end);
    this.draftText.set(next);
    const area: HTMLTextAreaElement | undefined = this.inputRef()?.nativeElement;
    if (area !== undefined) {
      area.value = next;
      const caret: number = start + text.length;
      area.setSelectionRange(caret, caret);
      this.autoGrow(area);
      area.focus();
    }
  }

  /**
   * Saves the manage-prompts modal's draft prompt into the library, clearing the form on success.
   */
  public savePrompt(): void {
    if (this.promptLibrary.save(this.newPromptName(), this.newPromptText())) {
      this.newPromptName.set('');
      this.newPromptText.set('');
    }
  }

  /**
   * Deletes a prompt from the library.
   * @param id The prompt's identifier.
   */
  public deletePrompt(id: string): void {
    this.promptLibrary.delete(id);
  }

  /**
   * Closes the manage-prompts modal.
   */
  public closeManagePrompts(): void {
    this.managePromptsOpen.set(false);
    this.newPromptName.set('');
    this.newPromptText.set('');
  }

  /**
   * Handles a paste into the composer: image clipboard content becomes attached thumbnail chips
   * (screenshots paste straight in); text pastes fall through to the text area untouched.
   * @param event The clipboard event.
   */
  public onPaste(event: ClipboardEvent): void {
    const files: File[] = Array.from(event.clipboardData?.items ?? [])
      .filter((entry: DataTransferItem): boolean => entry.type.startsWith('image/'))
      .map((entry: DataTransferItem): File | null => entry.getAsFile())
      .filter((file: File | null): file is File => file !== null);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    void this.addImageFiles(files);
  }

  /**
   * Allows image files to be dropped onto the composer.
   * @param event The drag event.
   */
  public onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  /**
   * Handles an image file dropped onto the composer, attaching it like a paste.
   * @param event The drop event.
   */
  public onDrop(event: DragEvent): void {
    event.preventDefault();
    const files: File[] = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) {
      void this.addImageFiles(files);
    }
  }

  /**
   * Attaches image files to the draft as base64, enforcing provider support, the accepted media
   * types, and the count/size caps — each rejection surfaces a transient hint rather than failing
   * silently.
   * @param files The candidate files.
   * @returns Returns a promise that resolves once every accepted file is attached.
   */
  public async addImageFiles(files: readonly File[]): Promise<void> {
    if (!this.supportsImages()) {
      this.showImageHint('The selected provider does not accept images.');
      return;
    }
    for (const file of files) {
      if (!IMAGE_TYPES.includes(file.type)) {
        this.showImageHint('Only PNG, JPEG, WebP, and GIF images can be attached.');
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        this.showImageHint('Images larger than 4 MB cannot be attached.');
        continue;
      }
      if (this.pendingImages().length >= MAX_IMAGES) {
        this.showImageHint(`At most ${MAX_IMAGES} images can be attached to one message.`);
        return;
      }
      const data: string | null = await this.readAsBase64(file);
      if (data !== null) {
        const image: AiImageRef = {
          mediaType: file.type,
          data,
          ...(file.name.length > 0 ? { name: file.name } : {}),
        };
        this.pendingImages.update((images: readonly AiImageRef[]): readonly AiImageRef[] => [
          ...images,
          image,
        ]);
      }
    }
  }

  /**
   * Removes an attached image chip before sending.
   * @param index The chip's position.
   */
  public removeImage(index: number): void {
    this.pendingImages.update((images: readonly AiImageRef[]): readonly AiImageRef[] =>
      images.filter((_: AiImageRef, position: number): boolean => position !== index),
    );
  }

  /**
   * Builds the data URI for an attached or transcript image thumbnail.
   * @param image The image.
   * @returns Returns the data URI.
   */
  public imageSrc(image: AiImageRef): string {
    return `data:${image.mediaType};base64,${image.data}`;
  }

  /**
   * Reads a file's bytes as base64 (without the data-URI prefix).
   * @param file The file to read.
   * @returns Returns the base64 data, or null when reading fails.
   */
  private readAsBase64(file: File): Promise<string | null> {
    return new Promise<string | null>((resolve: (data: string | null) => void): void => {
      const reader: FileReader = new FileReader();
      reader.onload = (): void => {
        const result: string = typeof reader.result === 'string' ? reader.result : '';
        const separator: number = result.indexOf(',');
        resolve(separator >= 0 ? result.slice(separator + 1) : null);
      };
      reader.onerror = (): void => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  /**
   * Shows a transient image-input hint, replacing any previous one.
   * @param message The hint text.
   */
  private showImageHint(message: string): void {
    this.imageHint.set(message);
    if (this.imageHintTimer !== null) {
      clearTimeout(this.imageHintTimer);
    }
    this.imageHintTimer = setTimeout((): void => this.imageHint.set(null), 4000);
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
    // The suggestion popup owns the navigation keys while it is open.
    const options: readonly ComposerSuggestion[] = this.suggestions();
    if (options.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step: number = event.key === 'ArrowDown' ? 1 : -1;
        this.suggestIndex.update(
          (index: number): number => (index + step + options.length) % options.length,
        );
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        this.acceptSuggestion(options[this.suggestIndex()]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.suggestToken.set(null);
        return;
      }
    }
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
