import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
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
import type { AgentContextRef, AgentSurface } from '@shared/api/ai-types';
import { Agent, AgentItem, AgentItemKind } from '@shared/angular/services/agent/agent';
import { formatCost, formatTokens } from '@shared/angular/services/agent/token-format';
import { Shell } from '@shared/angular/services/shell/shell';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Modal } from '@shared/angular/components/modal/modal';
import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';
import { MarkdownPipe } from './markdown-pipe';
import { friendlyToolLabel, technicalToolName } from './tool-summary';

/**
 * How close (px) to the bottom of the message list still counts as "at the bottom" for follow-the-tail
 * scrolling, absorbing sub-pixel rounding and the last line's leading so streaming stays pinned.
 */
const BOTTOM_THRESHOLD_PX: number = 24;

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
   * Gets the friendly one-line summary for a tool row (undefined for other kinds).
   */
  readonly label?: string;

  /**
   * Gets the technical tool identifier revealed when a tool row is expanded (undefined otherwise).
   */
  readonly tech?: string;
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
  imports: [AppIcon, Modal, MarkdownEditor, MarkdownPipe],
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
  protected readonly wordCount: Signal<string> = computed((): string => {
    const words: number = this.draftText()
      .trim()
      .split(/\s+/)
      .filter((word: string): boolean => word.length > 0).length;
    return words === 1 ? '1 word' : `${words} words`;
  });

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
      // Reasoning ('thinking') is streamed but not shown in the transcript.
      const base: RailEntry[] = items
        .filter((item: AgentItem): boolean => item.kind !== 'thinking')
        .map((item: AgentItem): RailEntry => ({ item, kind: item.kind }));
      const sequence: readonly RailEntry[] = showWorking
        ? [...base, { item: null, kind: 'working' }]
        : base;

      const onRail: (kind: TranscriptRowKind) => boolean = (kind: TranscriptRowKind): boolean =>
        kind === 'assistant' || kind === 'tool' || kind === 'working';

      const running: (entry: RailEntry) => boolean = (entry: RailEntry): boolean =>
        entry.kind === 'tool' && entry.item?.toolState === 'running';

      const nodeIconFor: (entry: RailEntry) => Icon = (entry: RailEntry): Icon => {
        switch (entry.kind) {
          case 'assistant':
            return Icon.AGENT;
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
        return {
          id: row.item?.id ?? 'working',
          kind: row.kind,
          item: row.item,
          timeline,
          connectsUp: timeline && previous !== undefined && onRail(previous.kind),
          connectsDown: timeline && next !== undefined && onRail(next.kind),
          nodeIcon: nodeIconFor(row),
          nodeSpin: row.kind === 'working' || running(row),
          label: row.kind === 'tool' ? friendlyToolLabel(row.item?.toolName) : undefined,
          tech: row.kind === 'tool' ? technicalToolName(row.item?.toolName) : undefined,
        };
      });
    },
  );

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
        if (id !== undefined) {
          this.tabs.setAttention(id, waiting && !active);
        }
      });
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
   * Records composer input.
   * @param value The new composer text.
   */
  public onInput(value: string): void {
    this.draftText.set(value);
  }

  /**
   * Sends the current draft: as the answer to a pending agent question when one is waiting (the
   * composer's answer mode), otherwise as a new message starting a run. Blank drafts are ignored.
   */
  public send(): void {
    const text: string = this.draftText();
    if (text.trim().length === 0) {
      return;
    }
    const pending: AgentItem | undefined = this.pendingInput();
    if (pending !== undefined) {
      this.agent.respondInput(pending, text.trim());
    } else {
      this.agent.send(text, this.tabId(), this.surface());
    }
    this.draftText.set('');
    // A fresh turn re-pins to the bottom even if the reader had scrolled up to read back.
    this.atBottom.set(true);
    // Collapse the auto-grown text area back to a single row now that it is empty.
    const element: HTMLTextAreaElement | undefined = this.inputRef()?.nativeElement;
    if (element !== undefined) {
      element.style.height = 'auto';
    }
  }

  /**
   * Answers a pending agent question with one of its suggested choices.
   * @param item The input-request item.
   * @param choice The chosen answer.
   */
  public choose(item: AgentItem, choice: string): void {
    this.agent.respondInput(item, choice);
  }

  /**
   * Declines to answer a pending agent question; the agent is told and continues without an answer.
   * @param item The input-request item.
   */
  public skipInput(item: AgentItem): void {
    this.agent.respondInput(item, null);
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
   * Answers a pending permission prompt.
   * @param item The permission item.
   * @param granted Whether the user granted permission.
   */
  public respond(item: AgentItem, granted: boolean): void {
    this.agent.respondPermission(item, granted);
  }

  /**
   * Handles composer key presses: sends on Enter, but leaves Shift+Enter to insert a newline.
   * @param event The keyboard event.
   */
  public onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    event.preventDefault();
    this.send();
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
