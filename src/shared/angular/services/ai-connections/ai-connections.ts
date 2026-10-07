import { inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import type {
  AiAuthKind,
  AiAuthStatus,
  AiConnection,
  AiDiscoverModelsResult,
  AiModelCheck,
  AiModelInfo,
  AiProviderKind,
  AuthMethod,
} from '@shared/api/ai-types';
import { API_KEY_AUTH } from '@shared/api/ai-types';
import { Settings } from '@shared/angular/services/settings/settings';
import { Ai } from '@shared/angular/services/ai/ai';
import { Log } from '@shared/angular/services/log/log';
import { AiProviders } from '@shared/angular/services/ai-providers/ai-providers';
import { appendModels, ModelReview, modelNames, offeredAgain, reviewModels } from './model-review';

/**
 * Describes the outcome of a Discover the user asked for.
 */
export interface DiscoverOutcome {
  /**
   * Gets whether the provider answered.
   */
  readonly ok: boolean;

  /**
   * Gets what happened, worded for display.
   */
  readonly detail: string;
}

/**
 * Describes a review of a connection's models.
 */
export interface ConnectionReview {
  /**
   * Gets the models the harness discovered, or null when it was not asked or could not answer.
   */
  readonly discovered: readonly AiModelInfo[] | null;

  /**
   * Gets the harness's own account of the discovery, empty when it was not asked.
   */
  readonly detail: string;

  /**
   * Gets what the review found.
   */
  readonly review: ModelReview;
}

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
   * Holds the providers installed plugins contribute, read for the models a new configuration starts
   * with — which is the plugin's to say, not core's.
   */
  private readonly providers: AiProviders = inject(AiProviders);

  /**
   * Holds the AI IPC client, or undefined outside Electron.
   */
  private readonly ai: Ai = inject(Ai);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

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
      this.connections().map((connection: AiConnection): Promise<void> =>
        this.refreshAuth(connection),
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
   * Adds a new connection of the given kind and returns it. When an authentication {@link AuthMethod} is
   * supplied (the per-company settings pages always do), the connection takes that method's auth kind,
   * default display name, and optional preset base URL; otherwise it falls back to the kind's default
   * label and auth (none for local Ollama, an API key otherwise). The id is unique within the list.
   * @param kind The provider kind.
   * @param method The authentication method the configuration is added through, when known.
   * @returns Returns the created connection.
   */
  public add(kind: AiProviderKind, method?: AuthMethod): AiConnection {
    // ⛔ Every fallback here is generic. It used to read a company name out of a `KIND_LABELS` table and
    // default the auth to `none` for `ollama` and an API key for everything else — core knowing two
    // specific providers by name, in the one place a configuration is created (#653). The method comes
    // from a contributed page, and the kind is the only honest label when it somehow does not.
    const models: readonly AiModelInfo[] = this.providers.modelsFor(kind);
    const connection: AiConnection = {
      id: this.uniqueId(kind),
      kind,
      label: method?.defaultDisplayName ?? kind,
      auth: method?.auth ?? API_KEY_AUTH,
      // 🔑 The configuration names the plugin that will run it from the moment it exists. The page it
      // was created from came from that plugin, so making the user then go and choose it — from a
      // dropdown that defaulted to a "Built-in" harness which no longer exists — was asking them to
      // repair something that was never broken until core stopped shipping a provider (#653, #697).
      ...(method?.harnessId === undefined ? {} : { harnessId: method.harnessId }),
      ...(method?.baseUrl !== undefined ? { baseUrl: method.baseUrl } : {}),
      models,
      defaultModelId: models[0]?.id ?? '',
    };
    this.settings.upsertConnection(connection);
    this.log.info('AiConnections', `Connection added '${connection.id}'`, kind, connection.auth);
    // Ask at once whether it can be used. Until it is asked its status is pending, which reads as
    // unavailable — a subscription already signed in would carry a warning for as long as the page
    // stayed open, since the list refreshes only what existed when it opened.
    void this.refreshAuth(connection);
    // A method that needs no key can be asked for its models straight away. The seeded list is a
    // snapshot frozen at the plugin's release; the plugin's harness knows what the provider offers
    // today, and nothing is lost by asking — a failure leaves the seeds in place.
    if (method?.harnessId !== undefined && method.auth !== API_KEY_AUTH) {
      void this.seedFromDiscovery(connection);
    }
    return connection;
  }

  /**
   * Gets the configured connections whose kind is one of the given kinds, in list order. Backs a
   * per-company settings page, which shows every configuration for its company's kind(s).
   * @param kinds The kinds to include.
   * @returns Returns the matching connections.
   */
  public connectionsForKinds(kinds: readonly AiProviderKind[]): readonly AiConnection[] {
    return this.connections().filter((connection: AiConnection): boolean =>
      kinds.includes(connection.kind),
    );
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
    this.log.info('AiConnections', `Connection removed '${id}'`);
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
    this.log.info('AiConnections', `API key stored for '${connection.id}'`);
    // The key is what discovery was waiting for: a configuration created through an API-key method
    // could not be asked until now. One still holding the plugin's seeds untouched is new, and takes
    // the discovered list outright; any other has been curated, and only gains (#866).
    const current: AiConnection = this.find(connection.id) ?? connection;
    void (this.holdsOnlySeeds(current)
      ? this.seedFromDiscovery(current)
      : this.discoverQuietly(current));
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
    this.log.info('AiConnections', `API key cleared for '${connection.id}'`);
  }

  /**
   * Discovers a connection's models at the user's request — Discover in settings — and adds what is new
   * (#866). Append-only: nothing in the list is removed, and a model the provider no longer offers is
   * marked retired instead. Models the user turned down from a notification are offered here too,
   * because pressing Discover is asking.
   * @param connection The connection.
   * @returns Returns the outcome, worded for display, or null when the bridge is unavailable.
   */
  public async discover(connection: AiConnection): Promise<DiscoverOutcome | null> {
    const review: ConnectionReview | null = await this.review(connection, {
      discover: true,
      includeDismissed: true,
    });
    if (review === null) {
      return null;
    }
    if (review.discovered === null) {
      return { ok: false, detail: review.detail };
    }
    this.applyReview(connection.id, review.review);
    this.addModels(connection.id, review.review.added);
    return { ok: true, detail: discoverDetail(review.review) };
  }

  /**
   * Reviews a connection's models against what its provider offers now, without adding anything
   * (#866). Retired flags are the caller's to apply with {@link applyReview}.
   * @param connection The connection.
   * @param options Whether to ask the harness (discovery starts it, so the background check rations
   * it), and whether to offer models the user turned down.
   * @returns Returns the review, or null when the bridge is unavailable.
   */
  public async review(
    connection: AiConnection,
    options: { readonly discover: boolean; readonly includeDismissed: boolean },
  ): Promise<ConnectionReview | null> {
    if (this.ai.client === undefined) {
      return null;
    }
    const result: AiDiscoverModelsResult | null = options.discover
      ? await this.discoverModels(connection)
      : null;
    if (result !== null && !result.ok) {
      this.log.debug(
        'AiConnections',
        `Model discovery did not answer for '${connection.id}'`,
        result.detail,
      );
    }
    const discovered: readonly AiModelInfo[] | null = result?.ok === true ? result.models : null;
    return {
      discovered,
      detail: result?.detail ?? '',
      review: reviewModels(
        connection.models,
        { discovered, manifest: this.providers.modelsFor(connection.kind) },
        options.includeDismissed ? [] : (connection.dismissedModelIds ?? []),
      ),
    };
  }

  /**
   * Applies a review's retired flags to a connection's current list. Marking is not a change to the
   * list — every model stays, and the user decides what to remove — so it needs no asking.
   * @param id The connection id.
   * @param review The review.
   */
  public applyReview(id: string, review: ModelReview): void {
    const current: AiConnection | undefined = this.find(id);
    if (current === undefined) {
      return;
    }
    const retired: ReadonlyMap<string, boolean> = new Map<string, boolean>(
      review.models.map((model: AiModelInfo): [string, boolean] => [
        model.id,
        model.retired === true,
      ]),
    );
    let changed: boolean = false;
    const models: AiModelInfo[] = current.models.map((model: AiModelInfo): AiModelInfo => {
      const now: boolean | undefined = retired.get(model.id);
      if (now === undefined || now === (model.retired === true)) {
        return model;
      }
      changed = true;
      if (now) {
        return { ...model, retired: true };
      }
      return offeredAgain(model);
    });
    if (changed) {
      this.update(id, { models });
    }
    if (review.retired.length > 0) {
      this.log.info(
        'AiConnections',
        `Models no longer offered for '${id}': ${review.retired.join(', ')}`,
      );
    }
  }

  /**
   * Adds models the user chose to a connection, after its own, and stops treating them as turned down.
   * @param id The connection id.
   * @param added The models.
   */
  public addModels(id: string, added: readonly AiModelInfo[]): void {
    const current: AiConnection | undefined = this.find(id);
    if (current === undefined || added.length === 0) {
      return;
    }
    const ids: ReadonlySet<string> = new Set<string>(
      added.map((model: AiModelInfo): string => model.id),
    );
    const models: readonly AiModelInfo[] = appendModels(current.models, added);
    this.update(id, {
      models,
      dismissedModelIds: (current.dismissedModelIds ?? []).filter(
        (modelId: string): boolean => !ids.has(modelId),
      ),
      ...(current.defaultModelId === '' ? { defaultModelId: models[0]?.id ?? '' } : {}),
    });
    this.log.info('AiConnections', `Models added to '${id}': ${[...ids].join(', ')}`);
  }

  /**
   * Remembers that the user turned models down, so they are not offered again until a Discover.
   * @param id The connection id.
   * @param modelIds The model ids.
   */
  public dismissModels(id: string, modelIds: readonly string[]): void {
    const current: AiConnection | undefined = this.find(id);
    if (current === undefined || modelIds.length === 0) {
      return;
    }
    const dismissed: Set<string> = new Set<string>(current.dismissedModelIds ?? []);
    for (const modelId of modelIds) {
      dismissed.add(modelId);
    }
    this.update(id, { dismissedModelIds: [...dismissed] });
    this.log.info('AiConnections', `Models turned down for '${id}': ${modelIds.join(', ')}`);
  }

  /**
   * Records a background check of a connection's models.
   * @param id The connection id.
   * @param check The check.
   */
  public markChecked(id: string, check: AiModelCheck): void {
    this.update(id, { modelCheck: check });
  }

  /**
   * Asks a connection's harness which models the account offers.
   * @param connection The connection.
   * @returns Returns the result, or null when the bridge is unavailable.
   */
  private async discoverModels(connection: AiConnection): Promise<AiDiscoverModelsResult | null> {
    // Asked with an empty list, so the main process's merge yields the discovered models alone.
    const result: AiDiscoverModelsResult | undefined = await this.ai.client?.discoverModels({
      connection: { ...connection, models: [] },
      claudeExecutable: {
        mode: this.settings.aiClaudeExecutable(),
        path: this.settings.aiClaudeExecutablePath(),
      },
    });
    return result ?? null;
  }

  /**
   * Replaces a new configuration's seeded models with what its harness discovers, without anything
   * waiting on the answer. Only at creation: the seeds are the plugin's guess at release time, and the
   * user has curated nothing yet. A failure is logged and leaves the seeds in place.
   * @param connection The connection.
   * @returns Resolves once discovery has settled, however it settled.
   */
  private async seedFromDiscovery(connection: AiConnection): Promise<void> {
    try {
      const result: AiDiscoverModelsResult | null = await this.discoverModels(connection);
      if (result?.ok !== true) {
        return;
      }
      const models: readonly AiModelInfo[] = result.models;
      const current: AiConnection | undefined = this.find(connection.id);
      const defaultModelId: string = models.some(
        (model: AiModelInfo): boolean => model.id === current?.defaultModelId,
      )
        ? (current?.defaultModelId ?? '')
        : (models[0]?.id ?? '');
      this.update(connection.id, { models, defaultModelId });
      this.log.info('AiConnections', `Discovered ${models.length} models for '${connection.id}'`);
    } catch (error: unknown) {
      this.log.warn('AiConnections', `Background discovery failed for '${connection.id}'`, error);
    }
  }

  /**
   * Discovers a connection's models in the background, append-only, as {@link discover} does.
   * @param connection The connection.
   * @returns Resolves once discovery has settled, however it settled.
   */
  private async discoverQuietly(connection: AiConnection): Promise<void> {
    try {
      await this.discover(connection);
    } catch (error: unknown) {
      this.log.warn('AiConnections', `Background discovery failed for '${connection.id}'`, error);
    }
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
      // Discovery not listing it is why it was added by hand, so discovery never retires it.
      manual: true,
    };
    this.update(connection.id, { models: [...connection.models, model] });
  }

  /**
   * Removes a model from a connection, clearing the default when it was the one removed. The model
   * counts as turned down, so a background check does not offer straight back what the user just
   * removed; Discover in settings still does (#866).
   * @param connection The connection.
   * @param modelId The model id.
   */
  public removeModel(connection: AiConnection, modelId: string): void {
    const models: AiModelInfo[] = connection.models.filter(
      (model: AiModelInfo): boolean => model.id !== modelId,
    );
    const dismissed: readonly string[] = connection.dismissedModelIds ?? [];
    this.update(connection.id, {
      models,
      ...(dismissed.includes(modelId) ? {} : { dismissedModelIds: [...dismissed, modelId] }),
      ...(connection.defaultModelId === modelId ? { defaultModelId: models[0]?.id ?? '' } : {}),
    });
  }

  /**
   * Determines whether a connection still holds exactly the models its plugin seeded it with, so it
   * has nothing of the user's to keep.
   * @param connection The connection.
   * @returns Returns true when the list is the untouched seed.
   */
  private holdsOnlySeeds(connection: AiConnection): boolean {
    const seeds: readonly AiModelInfo[] = this.providers.modelsFor(connection.kind);
    return (
      connection.models.length === seeds.length &&
      connection.models.every(
        (model: AiModelInfo, index: number): boolean =>
          model.id === seeds[index]?.id &&
          model.manual !== true &&
          model.pinned !== true &&
          model.hidden !== true,
      ) &&
      (connection.dismissedModelIds ?? []).length === 0
    );
  }

  /**
   * Toggles a model's pinned flag.
   * @param connection The connection.
   * @param modelId The model id.
   */
  public togglePinned(connection: AiConnection, modelId: string): void {
    this.mapModel(connection, modelId, (model: AiModelInfo): AiModelInfo => ({
      ...model,
      pinned: model.pinned !== true,
    }));
  }

  /**
   * Toggles a model's hidden flag.
   * @param connection The connection.
   * @param modelId The model id.
   */
  public toggleHidden(connection: AiConnection, modelId: string): void {
    this.mapModel(connection, modelId, (model: AiModelInfo): AiModelInfo => ({
      ...model,
      hidden: model.hidden !== true,
    }));
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
    const models: AiModelInfo[] = connection.models.map((model: AiModelInfo): AiModelInfo =>
      model.id === modelId ? map(model) : model,
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

/**
 * Words what a Discover the user asked for did to the list.
 * @param review The review it applied.
 * @returns Returns the sentence or two to show.
 */
function discoverDetail(review: ModelReview): string {
  const added: string =
    review.added.length === 0 ? 'No new models.' : `Added ${modelNames(review.added)}.`;
  const retired: readonly AiModelInfo[] = review.models.filter(
    (model: AiModelInfo): boolean => model.retired === true,
  );
  return retired.length === 0
    ? added
    : `${added} No longer offered: ${modelNames(retired)} — remove ${retired.length === 1 ? 'it' : 'them'} here if you no longer want ${retired.length === 1 ? 'it' : 'them'}.`;
}
