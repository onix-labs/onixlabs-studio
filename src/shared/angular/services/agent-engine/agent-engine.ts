import { computed, effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import type { AiConnection, AiModelInfo, AiProviderId, AiProviderInfo } from '@shared/api/ai-types';
import { AiRuntime } from '../ai-runtime/ai-runtime';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * Owns the global engine selection shared by every agent conversation: the registered providers (built
 * in the main process from the user's connections) and the user's connection/model choice (persisted
 * through {@link Settings}). The connection/model picked here is the same one the agent ribbon's Engine
 * group and the AI settings connection manager drive, and the one each {@link Agent} session runs
 * through. Selection is global by design — only the transcript is per-tab.
 */
@Service()
export class AgentEngine {
  /**
   * Holds the agent runtime providers are loaded from.
   */
  private readonly runtime: AiRuntime = inject(AiRuntime);

  /**
   * Holds the settings service, the persisted source of truth for connection/model selection and the
   * connection collection.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the registered providers and their availability.
   */
  private readonly providerList: WritableSignal<readonly AiProviderInfo[]> = signal<
    readonly AiProviderInfo[]
  >([]);

  /**
   * Gets the registered providers and their availability.
   */
  public readonly providers: Signal<readonly AiProviderInfo[]> = this.providerList.asReadonly();

  /**
   * Gets the selected connection id (persisted via {@link Settings}).
   */
  public readonly provider: Signal<AiProviderId> = this.settings.aiActiveConnectionId;

  /**
   * Gets the descriptor of the selected provider, or undefined before the providers load.
   */
  private readonly providerInfo: Signal<AiProviderInfo | undefined> = computed(
    (): AiProviderInfo | undefined =>
      this.providerList().find((info: AiProviderInfo): boolean => info.id === this.provider()),
  );

  /**
   * Gets the models offered by the selected connection, in display order.
   */
  public readonly models: Signal<readonly AiModelInfo[]> = computed(
    (): readonly AiModelInfo[] => this.providerInfo()?.models ?? [],
  );

  /**
   * Gets the effective model identifier: the user's choice when the connection offers it, otherwise the
   * connection's default (empty only before the providers load).
   */
  public readonly model: Signal<string> = computed((): string => {
    const models: readonly AiModelInfo[] = this.models();
    const chosen: string = this.settings.connectionModelFor(this.provider());
    if (models.some((candidate: AiModelInfo): boolean => candidate.id === chosen)) {
      return chosen;
    }
    return this.providerInfo()?.defaultModelId ?? '';
  });

  /**
   * Initializes a new instance of the {@link AgentEngine} class, loading the providers and reloading
   * them whenever the user's connections change (so an added, edited, or credentialled connection
   * becomes runnable live).
   */
  public constructor() {
    effect((): void => {
      const connections: readonly AiConnection[] = this.settings.aiConnections();
      void this.loadProviders(connections);
    });
  }

  /**
   * Rebuilds the main-process providers from the given connections and selects an available one when
   * the current selection is unavailable.
   * @param connections The user's connections; defaults to the current settings collection.
   * @returns Returns a promise that resolves once the providers are loaded.
   */
  public async loadProviders(
    connections: readonly AiConnection[] = this.settings.aiConnections(),
  ): Promise<void> {
    const providers: readonly AiProviderInfo[] =
      (await this.runtime.listProviders(connections)) ?? [];
    this.providerList.set(providers);
    this.log.debug('AgentEngine', `Loaded ${providers.length} providers`);
    const current: AiProviderId = this.provider();
    const currentAvailable: boolean = providers.some(
      (provider: AiProviderInfo): boolean => provider.id === current && provider.available,
    );
    if (!currentAvailable) {
      const fallback: AiProviderInfo | undefined = providers.find(
        (provider: AiProviderInfo): boolean => provider.available,
      );
      if (fallback !== undefined) {
        this.log.warn(
          'AgentEngine',
          `Active connection '${current}' unavailable; falling back to '${fallback.id}'`,
        );
        this.settings.setActiveConnection(fallback.id);
      }
    }
  }

  /**
   * Gets the connection with the given id from the user's configured connections, or undefined when none
   * matches. Lets a caller read a connection's auth kind (for example, to tell whether a run goes through
   * the Claude local login).
   * @param id The connection id.
   * @returns Returns the connection, or undefined.
   */
  public connection(id: AiProviderId): AiConnection | undefined {
    return this.settings
      .aiConnections()
      .find((connection: AiConnection): boolean => connection.id === id);
  }

  /**
   * Selects the connection runs go through.
   * @param id The connection id.
   */
  public setProvider(id: AiProviderId): void {
    this.log.info('AgentEngine', `Connection selected '${id}'`);
    this.settings.setActiveConnection(id);
  }

  /**
   * Selects the model runs go through, persisted per connection. The choice is honoured while the
   * active connection offers it and is otherwise ignored in favour of the connection's default (see
   * {@link model}).
   * @param id The model id.
   */
  public setModel(id: string): void {
    this.log.info('AgentEngine', `Model chosen '${id}'`, this.provider());
    this.settings.setConnectionModel(this.provider(), id);
  }
}
