import { computed, inject, Service, Signal } from '@angular/core';
import {
  installedContributions,
  PluginContribution,
  PluginSummary,
  slotCandidates,
} from '@shared/api/plugin-channels';
import { Log } from '@shared/angular/services/log/log';
import { Plugins } from './plugins';

/**
 * Offers a database engine to a Database Explorer that has none (#1095).
 *
 * A sibling of {@link import('./container-engine-prompt').ContainerEnginePrompt}, without the toast:
 * the Object Explorer's empty state is where the gap is met, and it makes the offer itself. On a fresh
 * installation no engine ships, and "no connections yet" would be the wrong thing to say — nothing can
 * be connected *to* until an engine is installed.
 */
@Service()
export class DatabaseEnginePrompt {
  /**
   * Holds the plugin client the offer reads and installs through.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the identifiers of the installed plugins' database engines, joined, so a change in what is
   * installed is one value changing.
   */
  public readonly installedKey: Signal<string> = computed((): string =>
    installedContributions(this.plugins.plugins(), 'database-engine')
      .map((contribution: PluginContribution): string => contribution.id)
      .sort()
      .join('\n'),
  );

  /**
   * Gets the plugins that would provide a database engine but are not installed, in catalogue order.
   */
  public readonly candidates: Signal<readonly PluginSummary[]> = computed(
    (): readonly PluginSummary[] =>
      slotCandidates(
        this.plugins.plugins(),
        (contribution: PluginContribution): boolean => contribution.slot === 'database-engine',
      ),
  );

  /**
   * Installs a plugin the empty state offers, through the same terms as the Plugin Manager.
   * @param plugin The plugin to install.
   * @returns Returns a promise that resolves once the install settles.
   */
  public install(plugin: PluginSummary): Promise<void> {
    this.log.info('DatabaseEnginePrompt', `Installing ${plugin.id} from the empty state`);
    return this.plugins.installWithConsent(plugin.id).then((): void => undefined);
  }
}
