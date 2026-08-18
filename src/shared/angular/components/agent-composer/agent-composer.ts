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
  output,
  OutputEmitterRef,
  signal,
  Signal,
  untracked,
  viewChild,
  WritableSignal,
} from '@angular/core';
import type {
  AgentContextRef,
  AgentSurface,
  AiEffort,
  AiImageRef,
  AiProviderInfo,
  AiSlashCommand,
} from '@shared/api/ai-types';
import { Agent, AgentItem, AgentQueuedMessage } from '@shared/angular/services/agent/agent';
import { AgentEngine } from '@shared/angular/services/agent-engine/agent-engine';
import { AgentPrompt, AgentPrompts } from '@shared/angular/services/agent-prompts/agent-prompts';
import { formatCost, formatTokens } from '@shared/angular/services/agent/token-format';
import { Search } from '@shared/angular/services/search/search';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { AgentLoginModal } from '@shared/angular/components/agent-login-modal/agent-login-modal';
import { MarkdownEditor } from '@shared/angular/components/markdown-editor/markdown-editor';

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
 * Slash commands the composer serves natively, so a provider-discovered command of the same name is not
 * offered twice (#330).
 */
const APP_NATIVE_COMMANDS: ReadonlySet<string> = new Set<string>([
  'compact',
  'clear',
  'mode',
  'effort',
  // Served natively (not dispatched as a turn): they drive the app's own in-app sign-in flow, not the
  // CLI's interactive UI, so a provider-discovered `/login`/`/logout` must not be offered alongside.
  'login',
  'logout',
]);

/**
 * Provider commands that have no headless seam — they drive the CLI's own interactive UI or local
 * state, so dispatching one as an agent turn would not work; they are filtered from the `/` menu (#330).
 * A conservative list; anything not here is offered and dispatched as input.
 */
const NON_DISPATCHABLE_COMMANDS: ReadonlySet<string> = new Set<string>([
  'login',
  'logout',
  'config',
  'doctor',
  'status',
  'cost',
  'resume',
  'help',
  'terminal-setup',
  'install-github-app',
  'upgrade',
  'release-notes',
  'bug',
  'vim',
]);

/**
 * An entry in the composer's suggestion popup: a built-in slash command, a library prompt, a
 * workspace file for an `@`-mention, or the manage-prompts affordance.
 */
interface ComposerSuggestion {
  /**
   * Gets what accepting the entry does.
   */
  readonly kind: 'command' | 'discovered' | 'prompt' | 'mention' | 'manage';

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
 * The command surface beneath an agent transcript: an auto-growing text area with the word count and
 * context meter, attached-context and image chips, the queued-message list, the `/` command and `@`
 * mention popups, and the send/stop controls. It drives the same {@link Agent} session the host
 * provides, so it is a sibling of {@link AgentChat}'s message list rather than a child of it — typing
 * marks only this component dirty, leaving the (potentially long) transcript's change detection
 * untouched, which is what keeps per-keystroke cost flat as a conversation grows. Sending emits
 * {@link sent} so the host can re-pin the transcript to the tail. Provider/model selection lives in the
 * agent ribbon or tool strip, not here.
 */
@Component({
  selector: 'app-agent-composer',
  imports: [Button, AppIcon, Modal, ModalContent, MarkdownEditor, AgentLoginModal],
  templateUrl: './agent-composer.html',
  styleUrl: './agent-composer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentComposer {
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
   * Gets whether the "not signed in to Claude" prompt is pending for this conversation, so the template
   * shows the login modal.
   */
  protected readonly needsLogin: Signal<boolean> = this.agent.needsLogin;

  /**
   * Holds the host-provided conversation, whose draft backs the composer text. Optional so the
   * component still stands up in isolation (tests).
   */
  private readonly conversation: AgentConversation | null = inject(AgentConversation, {
    optional: true,
  });

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
   * (e.g. the dockable agent panel). Carried on runs so the session attributes them correctly.
   */
  public readonly tabId: InputSignal<string | undefined> = input<string | undefined>(undefined);

  /**
   * Gets what this conversation's runs act on, which selects the tool set the providers expose: the
   * open editor document (`editor`, the default) or the owning terminal (`terminal`).
   */
  public readonly surface: InputSignal<AgentSurface> = input<AgentSurface>('editor');

  /**
   * Emits when a message (or a rewind/retry-through-edit) is dispatched, so the host can re-pin the
   * transcript to the tail even if the reader had scrolled up.
   */
  public readonly sent: OutputEmitterRef<void> = output<void>();

  /**
   * Holds the current composer text. Backed by the host conversation's {@link AgentConversation.draft}
   * when one is provided, so the draft persists (and stays shared) across a mirror chat being unmounted
   * and remounted — a Mission Control column typed into, left, and returned to keeps its text. Falls
   * back to a local signal when the component stands alone (tests).
   */
  private readonly draftText: WritableSignal<string> =
    this.conversation?.draft ?? signal<string>('');

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
   * Gets the composer's live word count, labelled for the hint line.
   */
  protected readonly wordCount: Signal<string> = computed((): string =>
    this.wordCountOf(this.draftText()),
  );

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
   * Gets the compact context-token readout for the composer meter (for example, `12.3k (34%)`): the
   * used-token figure, prefixed with `≈` while it includes an attached-context estimate, followed by
   * the percentage of the model's context window it fills when that window is known.
   */
  protected readonly contextLabel: Signal<string> = computed((): string => {
    const label: string = formatTokens(this.meterTokens());
    const used: string = this.agent.pendingContextTokens() > 0 ? `≈${label}` : label;
    return this.agent.contextWindow() > 0 ? `${used} (${this.contextPercent()}%)` : used;
  });

  /**
   * Gets how full the context window is, 0–100, for the meter fill; zero when the window is unknown.
   */
  protected readonly contextPercent: Signal<number> = computed((): number => {
    const window: number = this.agent.contextWindow();
    return window > 0 ? Math.min(100, Math.round((this.meterTokens() / window) * 100)) : 0;
  });

  /**
   * Gets the meter's fill level, driving its colour across three even bands as the window fills — a
   * visible cue to compact: `ok` (success) at 0–33%, `warn` (warning) at 34–66%, `high` (error) at
   * 67–100%.
   */
  protected readonly contextLevel: Signal<'ok' | 'warn' | 'high'> = computed(
    (): 'ok' | 'warn' | 'high' => {
      const percent: number = this.contextPercent();
      return percent >= 67 ? 'high' : percent >= 34 ? 'warn' : 'ok';
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
        ...this.claudeAuthCommands(),
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
        ...this.discoveredSuggestions(query),
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
   * Initializes a new instance of the {@link AgentComposer} class, ticking the elapsed indicator while
   * a run executes and pausing it whenever the run is blocked on the user — mirroring the wall-clock
   * budget's pause semantics.
   */
  public constructor() {
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
   * Sends the current draft: as the answer to a pending agent question when one is waiting (the
   * composer's answer mode), as a rewind-and-resend while a prior message is being edited (edit
   * mode), otherwise as a new message starting a run. Blank drafts are ignored. Emits {@link sent} so
   * the host re-pins the transcript to the tail.
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
    this.sent.emit();
    // Collapse the auto-grown text area back to a single row now that it is empty.
    const element: HTMLTextAreaElement | undefined = this.inputRef()?.nativeElement;
    if (element !== undefined) {
      element.style.height = 'auto';
    }
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
    this.sent.emit();
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
      case 'discovered':
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
   * Gets the clockwise rotation for a suggestion row's icon, in degrees. The manage row's settings
   * gear is tilted to match the gear everywhere else it appears; every other row stays upright.
   * @param option The suggestion.
   * @returns Returns the icon rotation in degrees.
   */
  protected suggestIconRotation(option: ComposerSuggestion): number {
    return option.kind === 'manage' ? 30 : 0;
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
    } else if (option.kind === 'discovered') {
      // A provider-discovered command (#330): drop `/name ` into the draft so the user can add any
      // arguments and send it — the live session executes the slash command when the turn runs.
      this.replaceComposerRange(token.start, end, `/${option.value} `);
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
   * Builds the composer entries for the live provider's discovered slash commands (#330), matching the
   * typed query, minus the app-native and non-dispatchable ones. Accepting one drops `/name ` into the
   * draft to send into the live session. Empty for providers that discover none.
   * @param query The lower-cased query typed after `/`.
   * @returns Returns the discovered-command suggestions.
   */
  private discoveredSuggestions(query: string): readonly ComposerSuggestion[] {
    return this.agent
      .discoveredCommands()
      .filter(
        (command: AiSlashCommand): boolean =>
          !APP_NATIVE_COMMANDS.has(command.name) &&
          !NON_DISPATCHABLE_COMMANDS.has(command.name) &&
          (query.length === 0 || command.name.toLowerCase().startsWith(query)),
      )
      .slice(0, MAX_SUGGESTIONS)
      .map(
        (command: AiSlashCommand): ComposerSuggestion => ({
          kind: 'discovered',
          label: `/${command.name}`,
          hint: command.description.length > 0 ? command.description : 'Provider command',
          value: command.name,
        }),
      );
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
   * Builds the `/login` and `/logout` command entries, offered only for the Claude local-login
   * connection (they drive Studio's in-app sign-in, which is meaningless for an API-key or other
   * provider). Empty for every other connection, so the commands are hidden there.
   * @returns Returns the sign-in command suggestions.
   */
  private claudeAuthCommands(): readonly ComposerSuggestion[] {
    if (this.agentEngine.connection(this.agent.provider())?.auth !== 'claude-login') {
      return [];
    }
    return [
      { kind: 'command', label: '/login', hint: 'Sign in to Claude', value: 'login' },
      { kind: 'command', label: '/logout', hint: 'Sign out of Claude', value: 'logout' },
    ];
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
    } else if (command === 'login') {
      this.agent.promptLogin();
    } else if (command === 'logout') {
      void this.agent.logout();
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
   * Builds the data URI for an attached image thumbnail.
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
   * cancel. Invoked by the host's transcript when its Edit affordance is clicked.
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
    const history: readonly string[] = this.agent
      .items()
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
   * Dismisses the "not signed in to Claude" prompt when the user closes the login modal without signing
   * in.
   */
  protected dismissLogin(): void {
    this.agent.dismissLoginPrompt();
  }

  /**
   * Completes a successful in-app sign-in: the conversation reopens its session (so the next turn
   * re-authenticates) and re-runs the turn that failed for want of a login.
   */
  protected onLoginSucceeded(): void {
    this.agent.onLoginSucceeded();
  }
}
