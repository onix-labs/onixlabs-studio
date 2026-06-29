import { computed, DestroyRef, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import type { AgentSurface, AiEvent, AiRunState } from '../../../shared/ai-types';
import { AiRuntime } from '../ai-runtime/ai-runtime';
import { AgentEngine } from '../agent-engine/agent-engine';
import { AgentSessionHandle } from '../agent-sessions/agent-sessions';
import { Settings } from '@shared/angular/services/settings/settings';
import { Workspace } from '../workspace/workspace';

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
export class Agent implements AgentSessionHandle {
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
   * Holds the identifier of the in-flight run, or null when none.
   */
  private activeRequestId: string | null = null;

  /**
   * Tracks the running counter used to generate unique item identifiers.
   */
  private sequence: number = 0;

  /**
   * Gets the ordered transcript.
   */
  public readonly items: Signal<readonly AgentItem[]> = this.log.asReadonly();

  /**
   * Gets a value indicating whether a run is in flight.
   */
  public readonly isRunning: Signal<boolean> = this.busy.asReadonly();

  /**
   * Gets a value indicating whether the agent is waiting on a permission decision.
   */
  public readonly awaitingDecision: Signal<boolean> = computed((): boolean =>
    this.log().some(
      (item: AgentItem): boolean => item.kind === 'permission' && item.permissionState === 'pending',
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
    });
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
   * Clears the transcript.
   */
  public clear(): void {
    this.log.set([]);
    this.activeRequestId = null;
    this.busy.set(false);
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
    this.update(item.id, (existing: AgentItem): AgentItem => ({
      ...existing,
      permissionState: granted ? 'allowed' : 'denied',
    }));
  }

  /**
   * Folds a streamed event into the transcript.
   * @param event The event.
   */
  private onEvent(event: AiEvent): void {
    if (event.requestId !== this.activeRequestId) {
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
      const reason: string = detail.trim().length > 0 ? detail : 'The agent run ended with an error.';
      this.push({ kind: 'assistant', text: `_${reason}_` });
    } else if (state === 'aborted') {
      this.push({ kind: 'assistant', text: '_Stopped._' });
    } else if (state === 'completed' && !this.producedReply()) {
      this.push({ kind: 'assistant', text: '_The model returned no output._' });
    }
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
      this.update(last.id, (existing: AgentItem): AgentItem => ({
        ...existing,
        text: existing.text + delta,
      }));
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
      items.map((item: AgentItem): AgentItem =>
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
