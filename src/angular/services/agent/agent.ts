import { computed, effect, inject, Service, signal, Signal, untracked, WritableSignal } from '@angular/core';
import type {
  AiEvent,
  AiProviderId,
  AiProviderInfo,
  AiRunState,
} from '../../../shared/ai-types';
import { AiRuntime } from '../ai-runtime/ai-runtime';
import { Tabs } from '../tabs/tabs';

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
 * Owns the agent conversation: it drives runs through the {@link AiRuntime} and folds the streamed
 * provider-agnostic events into a structured transcript (text, reasoning, tool activity, inline
 * permission prompts). State is exposed as signals so the agent tab and the dockable agent panel
 * render the same conversation. While a decision is pending on an inactive agent tab, that tab's
 * attention dot is lit.
 */
@Service()
export class Agent {
  /**
   * Holds the agent runtime the conversation runs through.
   */
  private readonly runtime: AiRuntime = inject(AiRuntime);

  /**
   * Holds the tab registry, used to flag agent tabs awaiting a decision.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the ordered transcript.
   */
  private readonly log: WritableSignal<readonly AgentItem[]> = signal<readonly AgentItem[]>([]);

  /**
   * Holds a value indicating whether a run is in flight.
   */
  private readonly busy: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the registered providers and their availability.
   */
  private readonly providerList: WritableSignal<readonly AiProviderInfo[]> = signal<
    readonly AiProviderInfo[]
  >([]);

  /**
   * Holds the selected provider.
   */
  private readonly providerId: WritableSignal<AiProviderId> = signal<AiProviderId>('claude');

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
   * Gets the registered providers and their availability.
   */
  public readonly providers: Signal<readonly AiProviderInfo[]> = this.providerList.asReadonly();

  /**
   * Gets the selected provider.
   */
  public readonly provider: Signal<AiProviderId> = this.providerId.asReadonly();

  /**
   * Gets a value indicating whether the agent is waiting on a permission decision.
   */
  public readonly awaitingDecision: Signal<boolean> = computed((): boolean =>
    this.log().some(
      (item: AgentItem): boolean => item.kind === 'permission' && item.permissionState === 'pending',
    ),
  );

  /**
   * Initializes a new instance of the {@link Agent} class, subscribing to runtime events, loading the
   * providers, and keeping agent-tab attention in sync with pending decisions.
   */
  public constructor() {
    this.runtime.onEvent((event: AiEvent): void => this.onEvent(event));
    void this.loadProviders();
    effect((): void => {
      const waiting: boolean = this.awaitingDecision();
      const active: string | undefined = this.tabs.activeTabId();
      untracked((): void => {
        for (const tab of this.tabs.tabs()) {
          if (tab.type === 'agent') {
            this.tabs.setAttention(tab.id, waiting && tab.id !== active);
          }
        }
      });
    });
  }

  /**
   * Loads the providers and selects an available one when the current selection is unavailable.
   * @returns Returns a promise that resolves once the providers are loaded.
   */
  public async loadProviders(): Promise<void> {
    const providers: readonly AiProviderInfo[] = await this.runtime.listProviders();
    this.providerList.set(providers);
    const current: AiProviderId = this.providerId();
    const currentAvailable: boolean = providers.some(
      (provider: AiProviderInfo): boolean => provider.id === current && provider.available,
    );
    if (!currentAvailable) {
      const fallback: AiProviderInfo | undefined = providers.find(
        (provider: AiProviderInfo): boolean => provider.available,
      );
      if (fallback !== undefined) {
        this.providerId.set(fallback.id);
      }
    }
  }

  /**
   * Selects the provider runs go through.
   * @param id The provider id.
   */
  public setProvider(id: AiProviderId): void {
    this.providerId.set(id);
  }

  /**
   * Sends a user message, starting a run. Blank messages and concurrent sends are ignored.
   * @param text The user's message.
   */
  public send(text: string): void {
    const trimmed: string = text.trim();
    if (trimmed.length === 0 || this.busy()) {
      return;
    }
    this.push({ kind: 'user', text: trimmed });
    this.busy.set(true);
    this.activeRequestId = this.runtime.run(this.providerId(), trimmed, null);
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
        this.onStatus(event.state);
        break;
      default:
        break;
    }
  }

  /**
   * Handles a run lifecycle change, ending the run on a terminal state.
   * @param state The new state.
   */
  private onStatus(state: AiRunState): void {
    if (state === 'started') {
      return;
    }
    this.busy.set(false);
    this.activeRequestId = null;
    if (state === 'error') {
      this.push({ kind: 'assistant', text: '_The agent run ended with an error._' });
    } else if (state === 'aborted') {
      this.push({ kind: 'assistant', text: '_Stopped._' });
    }
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
