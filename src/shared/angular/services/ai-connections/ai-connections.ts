import { inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import type {
  AiAuthKind,
  AiAuthStatus,
  AiConnection,
  AiDiscoverModelsResult,
  AiModelInfo,
  AiProviderKind,
} from '@shared/api/ai-types';
import { Settings } from '@shared/angular/services/settings/settings';
import { Ai } from '@shared/angular/services/ai/ai';

/**
 * The default human-readable label for a new connection of each kind.
 */
const KIND_LABELS: Readonly<Record<AiProviderKind, string>> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  xai: 'xAI (Grok)',
  google: 'Google (Gemini)',
  deepseek: 'DeepSeek',
  ollama: 'Ollama (local)',
  'openai-compatible': 'OpenAI-compatible',
  custom: 'Custom',
};

/**
 * The context window applied to a manually-added model until the user edits it or discovery refines it.
 */
const DEFAULT_MANUAL_CONTEXT_WINDOW: number = 32_768;

/**
 * The status reported for a connection whose auth has not been resolved yet (or when the agent bridge
 * is unavailable outside Electron).
 */
const PENDING_STATUS: AiAuthStatus = {
  source: 'none',
  available: false,
  hasStoredKey: false,
  detail: 'Checking…',
};

/**
 * Manages the user's AI provider connections in the renderer: the persisted connection collection (via
 * {@link Settings}), each connection's credential state and key management (via the main process, so the
 * key never enters the renderer), and model discovery and per-model curation. The connection list is the
 * single source of truth for provider configuration; selecting the active one for a run is the agent's
 * concern.
 */
@Service()
export class AiConnections {
  /**
   * Holds the settings service (the persisted connection collection).
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the AI IPC client, or undefined outside Electron.
   */
  private readonly ai: Ai = inject(Ai);

  /**
   * Holds the per-connection auth status cache, keyed by connection id.
   */
  private readonly authStatuses: WritableSignal<ReadonlyMap<string, AiAuthStatus>> = signal<
    ReadonlyMap<string, AiAuthStatus>
  >(new Map<string, AiAuthStatus>());

  /**
   * Gets the configured connections.
   */
  public readonly connections: Signal<readonly AiConnection[]> = this.settings.aiConnections;

  /**
   * Gets a value indicating whether the agent bridge is available (running inside Studio).
   */
  public readonly isAvailable: boolean = this.ai.client !== undefined;

  /**
   * Gets a connection's cached auth status, or a pending placeholder until it is resolved.
   * @param connectionId The connection id.
   * @returns Returns the auth status.
   */
  public authStatus(connectionId: string): AiAuthStatus {
    return this.authStatuses().get(connectionId) ?? PENDING_STATUS;
  }

  /**
   * Refreshes every connection's auth status from the main process.
   * @returns Returns a promise that resolves once all statuses are refreshed.
   */
  public async refreshAllAuth(): Promise<void> {
    await Promise.all(
      this.connections().map(
        (connection: AiConnection): Promise<void> => this.refreshAuth(connection),
      ),
    );
  }

  /**
   * Refreshes a single connection's auth status from the main process.
   * @param connection The connection.
   * @returns Returns a promise that resolves once the status is refreshed.
   */
  public async refreshAuth(connection: AiConnection): Promise<void> {
    const status: AiAuthStatus | undefined = await this.ai.client?.getConnectionAuthStatus({
      connectionId: connection.id,
      authKind: connection.auth,
    });
    if (status !== undefined) {
      this.putStatus(connection.id, status);
    }
  }

  /**
   * Adds a new connection of the given kind and returns it. The id is unique within the list; the auth
   * kind defaults to none for local Ollama and an API key otherwise.
   * @param kind The provider kind.
   * @returns Returns the created connection.
   */
  public add(kind: AiProviderKind): AiConnection {
    const connection: AiConnection = {
      id: this.uniqueId(kind),
      kind,
      label: KIND_LABELS[kind],
      auth: kind === 'ollama' ? 'none' : 'api-key',
      models: [],
      defaultModelId: '',
    };
    this.settings.upsertConnection(connection);
    return connection;
  }

  /**
   * Applies a partial update to a connection.
   * @param id The connection id.
   * @param patch The fields to change.
   */
  public update(id: string, patch: Partial<AiConnection>): void {
    const current: AiConnection | undefined = this.find(id);
    if (current !== undefined) {
      this.settings.upsertConnection({ ...current, ...patch });
    }
  }

  /**
   * Removes a connection.
   * @param id The connection id.
   */
  public remove(id: string): void {
    this.settings.removeConnection(id);
  }

  /**
   * Moves a connection up or down in the list.
   * @param id The connection id.
   * @param delta -1 to move up, 1 to move down.
   */
  public move(id: string, delta: -1 | 1): void {
    const list: AiConnection[] = [...this.connections()];
    const index: number = list.findIndex(
      (connection: AiConnection): boolean => connection.id === id,
    );
    const target: number = index + delta;
    if (index === -1 || target < 0 || target >= list.length) {
      return;
    }
    const [moved] = list.splice(index, 1);
    list.splice(target, 0, moved);
    this.settings.setAiConnections(list);
  }

  /**
   * Changes a connection's auth kind and refreshes its status.
   * @param id The connection id.
   * @param auth The new auth kind.
   */
  public setAuthKind(id: string, auth: AiAuthKind): void {
    const connection: AiConnection | undefined = this.find(id);
    if (connection !== undefined) {
      this.update(id, { auth });
      void this.refreshAuth({ ...connection, auth });
    }
  }

  /**
   * Stores a connection's API key in the main process and refreshes its status.
   * @param connection The connection.
   * @param key The API key to store.
   * @returns Returns a promise that resolves once the key is stored.
   */
  public async setKey(connection: AiConnection, key: string): Promise<void> {
    const status: AiAuthStatus | undefined = await this.ai.client?.setConnectionKey({
      connectionId: connection.id,
      authKind: connection.auth,
      key,
    });
    if (status !== undefined) {
      this.putStatus(connection.id, status);
    }
  }

  /**
   * Clears a connection's stored API key and refreshes its status.
   * @param connection The connection.
   * @returns Returns a promise that resolves once the key is cleared.
   */
  public async clearKey(connection: AiConnection): Promise<void> {
    const status: AiAuthStatus | undefined = await this.ai.client?.clearConnectionKey({
      connectionId: connection.id,
      authKind: connection.auth,
    });
    if (status !== undefined) {
      this.putStatus(connection.id, status);
    }
  }

  /**
   * Discovers a connection's models from its endpoint and merges them into its persisted list.
   * @param connection The connection.
   * @returns Returns the discovery result (its detail is suitable for display), or null when the
   * bridge is unavailable.
   */
  public async discover(connection: AiConnection): Promise<AiDiscoverModelsResult | null> {
    const result: AiDiscoverModelsResult | undefined = await this.ai.client?.discoverModels({
      connection,
    });
    if (result === undefined) {
      return null;
    }
    if (result.ok) {
      this.update(connection.id, { models: result.models });
    }
    return result;
  }

  /**
   * Adds a manually-entered model to a connection (ignored when blank or already present).
   * @param connection The connection.
   * @param id The model id.
   */
  public addModel(connection: AiConnection, id: string): void {
    const trimmed: string = id.trim();
    if (
      trimmed.length === 0 ||
      connection.models.some((m: AiModelInfo): boolean => m.id === trimmed)
    ) {
      return;
    }
    const model: AiModelInfo = {
      id: trimmed,
      label: trimmed,
      contextWindow: DEFAULT_MANUAL_CONTEXT_WINDOW,
    };
    this.update(connection.id, { models: [...connection.models, model] });
  }

  /**
   * Removes a model from a connection, clearing the default when it was the one removed.
   * @param connection The connection.
   * @param modelId The model id.
   */
  public removeModel(connection: AiConnection, modelId: string): void {
    const models: AiModelInfo[] = connection.models.filter(
      (model: AiModelInfo): boolean => model.id !== modelId,
    );
    this.update(connection.id, {
      models,
      ...(connection.defaultModelId === modelId ? { defaultModelId: models[0]?.id ?? '' } : {}),
    });
  }

  /**
   * Toggles a model's pinned flag.
   * @param connection The connection.
   * @param modelId The model id.
   */
  public togglePinned(connection: AiConnection, modelId: string): void {
    this.mapModel(
      connection,
      modelId,
      (model: AiModelInfo): AiModelInfo => ({
        ...model,
        pinned: model.pinned !== true,
      }),
    );
  }

  /**
   * Toggles a model's hidden flag.
   * @param connection The connection.
   * @param modelId The model id.
   */
  public toggleHidden(connection: AiConnection, modelId: string): void {
    this.mapModel(
      connection,
      modelId,
      (model: AiModelInfo): AiModelInfo => ({
        ...model,
        hidden: model.hidden !== true,
      }),
    );
  }

  /**
   * Sets a connection's default model.
   * @param connection The connection.
   * @param modelId The model id.
   */
  public setDefaultModel(connection: AiConnection, modelId: string): void {
    this.update(connection.id, { defaultModelId: modelId });
  }

  /**
   * Applies a mapping to one model within a connection.
   * @param connection The connection.
   * @param modelId The model id to map.
   * @param map The mapping applied to the matching model.
   */
  private mapModel(
    connection: AiConnection,
    modelId: string,
    map: (model: AiModelInfo) => AiModelInfo,
  ): void {
    const models: AiModelInfo[] = connection.models.map(
      (model: AiModelInfo): AiModelInfo => (model.id === modelId ? map(model) : model),
    );
    this.update(connection.id, { models });
  }

  /**
   * Finds a connection by id.
   * @param id The connection id.
   * @returns Returns the connection, or undefined.
   */
  private find(id: string): AiConnection | undefined {
    return this.connections().find((connection: AiConnection): boolean => connection.id === id);
  }

  /**
   * Generates a connection id unique within the current list, based on the kind.
   * @param kind The provider kind.
   * @returns Returns the unique id.
   */
  private uniqueId(kind: AiProviderKind): string {
    const used: Set<string> = new Set<string>(
      this.connections().map((connection: AiConnection): string => connection.id),
    );
    let index: number = 1;
    let candidate: string = `${kind}-${index}`;
    while (used.has(candidate)) {
      index += 1;
      candidate = `${kind}-${index}`;
    }
    return candidate;
  }

  /**
   * Writes a connection's auth status into the cache.
   * @param connectionId The connection id.
   * @param status The status.
   */
  private putStatus(connectionId: string, status: AiAuthStatus): void {
    this.authStatuses.update(
      (current: ReadonlyMap<string, AiAuthStatus>): ReadonlyMap<string, AiAuthStatus> =>
        new Map<string, AiAuthStatus>(current).set(connectionId, status),
    );
  }
}
