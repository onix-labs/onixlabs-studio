import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import type { AiModelInfo, AiProviderId, AiProviderInfo } from '../../../shared/ai-types';
import { AiRuntime } from '../ai-runtime/ai-runtime';
import { Settings } from '../settings/settings';

/**
 * Owns the global engine selection shared by every agent conversation: the registered providers and
 * the user's provider/model choice (persisted through {@link Settings}). The provider/model picked
 * here is the same one the agent ribbon's Engine group and the AI settings section drive, and the one
 * each {@link Agent} session runs through. Selection is global by design — only the transcript is
 * per-tab.
 */
@Service()
export class AgentEngine {
  /**
   * Holds the agent runtime providers are loaded from.
   */
  private readonly runtime: AiRuntime = inject(AiRuntime);

  /**
   * Holds the settings service, the persisted source of truth for provider/model selection.
   */
  private readonly settings: Settings = inject(Settings);

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
   * Gets the selected provider (persisted via {@link Settings}).
   */
  public readonly provider: Signal<AiProviderId> = this.settings.aiProvider;

  /**
   * Gets the descriptor of the selected provider, or undefined before the providers load.
   */
  private readonly providerInfo: Signal<AiProviderInfo | undefined> = computed(
    (): AiProviderInfo | undefined =>
      this.providerList().find((info: AiProviderInfo): boolean => info.id === this.provider()),
  );

  /**
   * Gets the models offered by the selected provider, in display order.
   */
  public readonly models: Signal<readonly AiModelInfo[]> = computed(
    (): readonly AiModelInfo[] => this.providerInfo()?.models ?? [],
  );

  /**
   * Gets the effective model identifier: the user's choice when the provider offers it, otherwise the
   * provider's default (empty only before the providers load).
   */
  public readonly model: Signal<string> = computed((): string => {
    const models: readonly AiModelInfo[] = this.models();
    const chosen: string = this.settings.aiModelFor(this.provider());
    if (models.some((candidate: AiModelInfo): boolean => candidate.id === chosen)) {
      return chosen;
    }
    return this.providerInfo()?.defaultModelId ?? '';
  });

  /**
   * Initializes a new instance of the {@link AgentEngine} class, loading the providers.
   */
  public constructor() {
    void this.loadProviders();
  }

  /**
   * Loads the providers and selects an available one when the current selection is unavailable.
   * @returns Returns a promise that resolves once the providers are loaded.
   */
  public async loadProviders(): Promise<void> {
    const providers: readonly AiProviderInfo[] = await this.runtime.listProviders();
    this.providerList.set(providers);
    const current: AiProviderId = this.provider();
    const currentAvailable: boolean = providers.some(
      (provider: AiProviderInfo): boolean => provider.id === current && provider.available,
    );
    if (!currentAvailable) {
      const fallback: AiProviderInfo | undefined = providers.find(
        (provider: AiProviderInfo): boolean => provider.available,
      );
      if (fallback !== undefined) {
        this.settings.setAiProvider(fallback.id);
      }
    }
  }

  /**
   * Selects the provider runs go through.
   * @param id The provider id.
   */
  public setProvider(id: AiProviderId): void {
    this.settings.setAiProvider(id);
  }

  /**
   * Selects the model runs go through, persisted per provider. The choice is honoured while the active
   * provider offers it and is otherwise ignored in favour of the provider's default (see
   * {@link model}).
   * @param id The model id.
   */
  public setModel(id: string): void {
    this.settings.setAiModel(this.provider(), id);
  }
}
