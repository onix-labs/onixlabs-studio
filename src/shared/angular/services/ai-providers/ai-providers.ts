import { computed, inject, Injectable, Signal } from '@angular/core';
import {
  type ContributedAiProvider,
  installedContributions,
  type UnkeyedPluginContribution,
} from '@shared/api/plugin-channels';
import {
  type AiModelInfo,
  modelsForKind,
  pagesFromContributions,
  type ProviderPage,
} from '@shared/api/ai-types';
import { Plugins } from '@shared/angular/services/plugins/plugins';

/**
 * The AI providers available on this machine, which is exactly the providers the **installed** agent
 * harnesses contribute.
 *
 * ⛔ There is no built-in list behind this (#653). Core shipped one — Anthropic, OpenAI, Google,
 * DeepSeek, xAI and Ollama, each with its sign-in methods and its models — so a fresh binary offered
 * pages for providers it had no way to run, and no way to stop offering them. Installing a plugin is
 * what makes a provider available now, and uninstalling one takes its page away again.
 *
 * Derived rather than fetched: the plugin client already holds every installed contribution for the
 * Plugin Manager and the harness picker, so this is a projection of that same list and cannot disagree
 * with it about what is installed.
 */
@Injectable({ providedIn: 'root' })
export class AiProviders {
  /**
   * Holds the plugin client, read for the harnesses installed on this machine.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Gets the providers contributed by installed harnesses, in contribution order.
   */
  public readonly contributed: Signal<readonly ContributedAiProvider[]> = computed(
    (): readonly ContributedAiProvider[] =>
      installedContributions(this.plugins.plugins(), 'agent-harness').flatMap(
        (harness: UnkeyedPluginContribution): readonly ContributedAiProvider[] =>
          harness.providers ?? [],
      ),
  );

  /**
   * Gets the company pages to show in settings, empty when no provider plugin is installed.
   */
  public readonly pages: Signal<readonly ProviderPage[]> = computed((): readonly ProviderPage[] =>
    pagesFromContributions(this.contributed()),
  );

  /**
   * Gets the company name for a provider kind, or undefined when no installed harness claims it.
   * @param kind The provider kind.
   * @returns Returns the company name, or undefined.
   */
  public companyFor(kind: string): string | undefined {
    return this.contributed().find(
      (provider: ContributedAiProvider): boolean => provider.kind === kind,
    )?.company;
  }

  /**
   * Gets the models a new configuration of a kind starts with.
   * @param kind The provider kind.
   * @returns Returns the models, empty when none were contributed.
   */
  public modelsFor(kind: string): readonly AiModelInfo[] {
    return modelsForKind(this.contributed(), kind);
  }
}
