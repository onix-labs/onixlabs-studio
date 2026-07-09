import {
  computed,
  DestroyRef,
  inject,
  Service,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import type {
  AgentContextRef,
  AgentMode,
  AgentSurface,
  AiEvent,
  AiRunState,
} from '@shared/api/ai-types';
import { AiRuntime } from '../ai-runtime/ai-runtime';
import { AgentEngine } from '../agent-engine/agent-engine';
import { Settings } from '@shared/angular/services/settings/settings';
import { Workspace } from '@shared/angular/services/workspace/workspace';

/**
 * Identifies the kind of transcript item.
 */
export type AgentItemKind = 'user' | 'assistant' | 'thinking' | 'tool' | 'permission';

/**
 * Identifies the lifecycle state of a tool item.
 */
export type AgentToolState = 'running' | 'ok' | 'error';

/**
 * Identifies the state of a permission request item.
 */
export type AgentPermissionState = 'pending' | 'allowed' | 'denied';

/**
 * A single item in the agent transcript. The fields used depend on {@link kind}: user/assistant/
 * thinking carry {@link text}; tool carries the tool fields; permission carries the permission fields.
 */
export interface AgentItem {
  /**
   * Gets the unique identifier of the item.
   */
  readonly id: string;

  /**
   * Gets the item kind.
   */
  readonly kind: AgentItemKind;

  /**
   * Gets the text content (user/assistant/thinking items).
   */
  readonly text: string;

  /**
   * Gets the correlation id of a tool use.
   */
  readonly toolId?: string;

  /**
   * Gets the tool's display name.
   */
  readonly toolName?: string;

  /**
   * Gets a one-line summary of the tool input.
   */
  readonly toolDetail?: string;

  /**
   * Gets the tool's lifecycle state.
   */
  readonly toolState?: AgentToolState;

  /**
   * Gets the id used to answer a permission request.
   */
  readonly permissionId?: string;

  /**
   * Gets the display name of the tool requesting permission.
   */
  readonly permissionName?: string;

  /**
   * Gets a one-line summary of what the gated tool will do.
   */
  readonly permissionDetail?: string;

  /**
   * Gets the permission request's state.
   */
  readonly permissionState?: AgentPermissionState;
}

/**
 * Owns a single agent conversation: it drives runs through the {@link AiRuntime} and folds the
 * streamed provider-agnostic events into a structured transcript (text, reasoning, tool activity,
 * inline permission prompts). State is exposed as signals so the hosting view renders the
 * conversation. The provider/model the run goes through is the global selection owned by
 * {@link AgentEngine}.
 *
 * This service is per-conversation, not a singleton: it is provided at the {@link AgentChat}
 * component level so every agent tab and the dockable agent panel each get their own transcript.
 */
@Service({ autoProvided: false })
export class Agent {
  /**
   * Holds the agent runtime the conversation runs through.
   */
  private readonly runtime: AiRuntime = inject(AiRuntime);

  /**
   * Holds the global engine selection, the source of the provider and model a run goes through.
   */
  private readonly engine: AgentEngine = inject(AgentEngine);

  /**
   * Holds the workspace, used to scope runs to the open folder.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the settings service, the source of the run's permission posture and token cap.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the destroy notifier used to unsubscribe this conversation from runtime events.
   */
  private readonly destroyRef: DestroyRef = inject(DestroyRef);

  /**
   * Holds the ordered transcript.
   */
  private readonly log: WritableSignal<readonly AgentItem[]> = signal<readonly AgentItem[]>([]);

  /**
   * Holds a value indicating whether a run is in flight.
   */
  private readonly busy: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds how much autonomy the conversation's runs use: `agent` (full tools) or `chat` (read-only).
   * The user's choice persists across new chats within this session.
   */
  private readonly modeState: WritableSignal<AgentMode> = signal<AgentMode>('agent');

  /**
   * Holds the files and folders attached to the conversation's context, passed to each run so the agent
   * can read them with its own file tools. Cleared when the conversation is cleared or restored.
   */
  private readonly contextPathsState: WritableSignal<readonly AgentContextRef[]> = signal<
    readonly AgentContextRef[]
  >([]);

  /**
   * Holds the identifier of the in-flight run, or null when none.
   */
  private activeRequestId: string | null = null;

  /**
   * Tracks the running counter used to generate unique item identifiers.
   */
  private sequence: number = 0;

  /**
   * Holds a value indicating whether the in-flight run is a compaction run, whose streamed text is
   * buffered into {@link compactionText} and folded into a single summary item rather than appended.
   */
  private compacting: boolean = false;

  /**
   * Accumulates the summary text streamed by a compaction run.
   */
  private compactionText: string = '';

  /**
   * Gets the ordered transcript.
   */
  public readonly items: Signal<readonly AgentItem[]> = this.log.asReadonly();

  /**
   * Gets a value indicating whether a run is in flight.
   */
  public readonly isRunning: Signal<boolean> = this.busy.asReadonly();

  /**
   * Gets how much autonomy the conversation's runs use: `agent` (full tools) or `chat` (read-only).
   */
  public readonly mode: Signal<AgentMode> = this.modeState.asReadonly();

  /**
   * Gets the files and folders attached to the conversation's context.
   */
  public readonly contextPaths: Signal<readonly AgentContextRef[]> =
    this.contextPathsState.asReadonly();

  /**
   * Gets a value indicating whether the agent is waiting on a permission decision.
   */
  public readonly awaitingDecision: Signal<boolean> = computed((): boolean =>
    this.log().some(
      (item: AgentItem): boolean =>
        item.kind === 'permission' && item.permissionState === 'pending',
    ),
  );

  /**
   * Initializes a new instance of the {@link Agent} class, subscribing to runtime events for the
   * lifetime of the hosting view.
   */
  public constructor() {
    const unsubscribe: () => void = this.runtime.onEvent((event: AiEvent): void =>
      this.onEvent(event),
    );
    this.destroyRef.onDestroy(unsubscribe);
  }

  /**
   * Sends a user message, starting a run. Blank messages and concurrent sends are ignored.
   * @param text The user's message.
   * @param owningTabId The identifier of the editor or terminal tab hosting this agent, so its in-app
   * tools act on that tab; omitted for the standalone agent tab.
   * @param surface What this run acts on, which selects the tool set the providers expose; omitted
   * for the editor surface.
   */
  public send(text: string, owningTabId?: string, surface?: AgentSurface): void {
    const trimmed: string = text.trim();
    if (trimmed.length === 0 || this.busy()) {
      return;
    }
    this.push({ kind: 'user', text: trimmed });
    this.busy.set(true);
    this.activeRequestId = this.runtime.run(this.engine.provider(), trimmed, {
      workspaceRoot: this.workspace.root()?.path ?? null,
      model: this.engine.model(),
      permissionPosture: this.settings.aiPermissionPosture(),
      tokenCap: this.settings.aiTokenCap(),
      owningTabId,
      surface,
      mode: this.modeState(),
      contextPaths: this.contextPathsState(),
    });
  }

  /**
   * Sets how much autonomy the conversation's runs use.
   * @param mode The new mode: `agent` (full tools) or `chat` (read-only).
   */
  public setMode(mode: AgentMode): void {
    this.modeState.set(mode);
  }

  /**
   * Attaches a file or folder to the conversation's context, ignoring a path already attached.
   * @param ref The file or folder to attach.
   */
  public attachContext(ref: AgentContextRef): void {
    if (this.contextPathsState().some((existing: AgentContextRef): boolean => existing.path === ref.path)) {
      return;
    }
    this.contextPathsState.update((refs: readonly AgentContextRef[]): readonly AgentContextRef[] => [
      ...refs,
      ref,
    ]);
  }

  /**
   * Removes an attached file or folder from the conversation's context.
   * @param path The path to detach.
   */
  public removeContext(path: string): void {
    this.contextPathsState.update((refs: readonly AgentContextRef[]): readonly AgentContextRef[] =>
      refs.filter((ref: AgentContextRef): boolean => ref.path !== path),
    );
  }

  /**
   * Stops the in-flight run.
   */
  public stop(): void {
    if (this.activeRequestId !== null) {
      this.runtime.abort(this.activeRequestId);
    }
  }

  /**
   * Compacts the conversation: runs a read-only summarisation turn over the current transcript, then
   * replaces the transcript with the single summary it produces. Blank transcripts and concurrent runs
   * are ignored. The summary streams as a live run (the working indicator shows) and lands as one
   * assistant item once complete.
   */
  public compact(): void {
    const history: readonly AgentItem[] = this.log();
    if (this.busy() || history.length === 0) {
      return;
    }
    this.compacting = true;
    this.compactionText = '';
    this.busy.set(true);
    this.activeRequestId = this.runtime.run(
      this.engine.provider(),
      this.compactionPrompt(history),
      {
        workspaceRoot: this.workspace.root()?.path ?? null,
        model: this.engine.model(),
        permissionPosture: 'prompt',
        tokenCap: this.settings.aiTokenCap(),
        mode: 'chat',
      },
    );
  }

  /**
   * Clears the transcript.
   */
  public clear(): void {
    this.log.set([]);
    this.activeRequestId = null;
    this.busy.set(false);
    this.contextPathsState.set([]);
  }

  /**
   * Replaces the transcript with a restored conversation, ending any in-flight run and reseeding the
   * id counter past the restored items so subsequently appended items keep unique ids. Used to
   * rehydrate a persisted conversation into this session.
   * @param items The restored transcript items.
   */
  public restore(items: readonly AgentItem[]): void {
    this.activeRequestId = null;
    this.busy.set(false);
    this.contextPathsState.set([]);
    this.sequence = items.reduce((max: number, item: AgentItem): number => {
      const parsed: number = Number.parseInt(item.id.replace(/^item-/, ''), 10);
      return Number.isFinite(parsed) && parsed > max ? parsed : max;
    }, 0);
    this.log.set([...items]);
  }

  /**
   * Answers a pending permission request.
   * @param item The permission item.
   * @param granted Whether the user granted permission.
   */
  public respondPermission(item: AgentItem, granted: boolean): void {
    if (item.permissionId === undefined || item.permissionState !== 'pending') {
      return;
    }
    this.runtime.respondPermission(item.permissionId, granted);
    this.update(
      item.id,
      (existing: AgentItem): AgentItem => ({
        ...existing,
        permissionState: granted ? 'allowed' : 'denied',
      }),
    );
  }

  /**
   * Folds a streamed event into the transcript.
   * @param event The event.
   */
  private onEvent(event: AiEvent): void {
    if (event.requestId !== this.activeRequestId) {
      return;
    }
    // A compaction run's output does not join the transcript: its text is buffered and folded into a
    // single summary item when the run completes.
    if (this.compacting) {
      if (event.kind === 'text') {
        this.compactionText += event.delta;
      } else if (event.kind === 'status') {
        this.onCompactionStatus(event.state, event.detail);
      }
      return;
    }
    switch (event.kind) {
      case 'text':
        this.appendText('assistant', event.delta);
        break;
      case 'thinking':
        this.appendText('thinking', event.delta);
        break;
      case 'tool-start':
        this.push({
          kind: 'tool',
          text: '',
          toolId: event.toolId,
          toolName: event.name,
          toolDetail: event.detail,
          toolState: 'running',
        });
        break;
      case 'tool-end':
        this.endTool(event.toolId, event.ok);
        break;
      case 'permission':
        this.push({
          kind: 'permission',
          text: '',
          permissionId: event.permissionId,
          permissionName: event.name,
          permissionDetail: event.detail,
          permissionState: 'pending',
        });
        break;
      case 'status':
        this.onStatus(event.state, event.detail);
        break;
      default:
        break;
    }
  }

  /**
   * Handles a run lifecycle change, ending the run on a terminal state. Every terminal state leaves a
   * visible mark so a run never just stops with no explanation: an error shows its reason, a stop is
   * noted, and a run that completed without producing any output says so.
   * @param state The new state.
   * @param detail A short description carried by the event (the failure reason on an error).
   */
  private onStatus(state: AiRunState, detail: string): void {
    if (state === 'started') {
      return;
    }
    this.busy.set(false);
    this.activeRequestId = null;
    if (state === 'error') {
      const reason: string =
        detail.trim().length > 0 ? detail : 'The agent run ended with an error.';
      this.push({ kind: 'assistant', text: `_${reason}_` });
    } else if (state === 'aborted') {
      this.push({ kind: 'assistant', text: '_Stopped._' });
    } else if (state === 'completed' && !this.producedReply()) {
      this.push({ kind: 'assistant', text: '_The model returned no output._' });
    }
  }

  /**
   * Ends a compaction run. On success the whole transcript is replaced with the single summary the run
   * produced; a failed or stopped compaction leaves the transcript untouched and notes what happened.
   * @param state The new state.
   * @param detail A short description carried by the event (the failure reason on an error).
   */
  private onCompactionStatus(state: AiRunState, detail: string): void {
    if (state === 'started') {
      return;
    }
    this.busy.set(false);
    this.activeRequestId = null;
    this.compacting = false;
    const summary: string = this.compactionText.trim();
    if (state === 'error') {
      const reason: string = detail.trim().length > 0 ? detail : 'unknown error';
      this.push({ kind: 'assistant', text: `_Compaction failed: ${reason}_` });
    } else if (state === 'aborted') {
      this.push({ kind: 'assistant', text: '_Compaction stopped._' });
    } else if (summary.length === 0) {
      this.push({ kind: 'assistant', text: '_Compaction produced no summary._' });
    } else {
      this.sequence += 1;
      this.log.set([
        {
          id: `item-${this.sequence}`,
          kind: 'assistant',
          text: `**Conversation summary**\n\n${summary}`,
        },
      ]);
    }
  }

  /**
   * Builds the summarisation prompt for a compaction run from the current transcript.
   * @param history The transcript to summarise.
   * @returns Returns the prompt.
   */
  private compactionPrompt(history: readonly AgentItem[]): string {
    const transcript: string = history
      .filter((item: AgentItem): boolean => item.kind === 'user' || item.kind === 'assistant')
      .map((item: AgentItem): string => `${item.kind === 'user' ? 'User' : 'Assistant'}: ${item.text}`)
      .join('\n\n');
    return (
      'Summarise the following conversation into a concise briefing that preserves the key facts, ' +
      'decisions, file names, code paths, and any open questions or next steps. Use short markdown ' +
      'sections. Do not use any tools — just write the summary.\n\n' +
      transcript
    );
  }

  /**
   * Gets a value indicating whether the run produced anything after the user's message (any assistant
   * text, reasoning, tool activity, or permission prompt). Used to flag an empty completion.
   * @returns Returns true when the last transcript item is not the user's prompt.
   */
  private producedReply(): boolean {
    const items: readonly AgentItem[] = this.log();
    const last: AgentItem | undefined = items[items.length - 1];
    return last !== undefined && last.kind !== 'user';
  }

  /**
   * Appends streamed text to the trailing item of the same kind, or starts a new one.
   * @param kind The text item kind.
   * @param delta The text chunk.
   */
  private appendText(kind: 'assistant' | 'thinking', delta: string): void {
    const items: readonly AgentItem[] = this.log();
    const last: AgentItem | undefined = items[items.length - 1];
    if (last?.kind === kind) {
      this.update(
        last.id,
        (existing: AgentItem): AgentItem => ({
          ...existing,
          text: existing.text + delta,
        }),
      );
    } else {
      this.push({ kind, text: delta });
    }
  }

  /**
   * Marks a tool item complete.
   * @param toolId The tool correlation id.
   * @param ok Whether the tool succeeded.
   */
  private endTool(toolId: string, ok: boolean): void {
    this.log.update((items: readonly AgentItem[]): readonly AgentItem[] =>
      items.map(
        (item: AgentItem): AgentItem =>
          item.kind === 'tool' && item.toolId === toolId
            ? { ...item, toolState: ok ? 'ok' : 'error' }
            : item,
      ),
    );
  }

  /**
   * Appends a new item with a fresh identifier.
   * @param item The item without its id.
   */
  private push(item: Omit<AgentItem, 'id'>): void {
    this.sequence += 1;
    const created: AgentItem = { id: `item-${this.sequence}`, ...item };
    this.log.update((items: readonly AgentItem[]): readonly AgentItem[] => [...items, created]);
  }

  /**
   * Replaces the item with the given id.
   * @param id The item id.
   * @param map The mapping applied to the item.
   */
  private update(id: string, map: (item: AgentItem) => AgentItem): void {
    this.log.update((items: readonly AgentItem[]): readonly AgentItem[] =>
      items.map((item: AgentItem): AgentItem => (item.id === id ? map(item) : item)),
    );
  }
}
