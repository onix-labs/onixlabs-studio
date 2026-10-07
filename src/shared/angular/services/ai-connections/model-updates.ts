import { effect, inject, Service, untracked } from '@angular/core';
import type { AiConnection, AiModelInfo } from '@shared/api/ai-types';
import type { PluginContribution, PluginSummary } from '@shared/api/plugin-channels';
import { AiProviders } from '@shared/angular/services/ai-providers/ai-providers';
import { Log } from '@shared/angular/services/log/log';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { AiConnections, ConnectionReview } from './ai-connections';
import { modelNames } from './model-review';

/**
 * How long a background check holds before discovery is asked again. Discovery starts the provider's
 * harness, so it is rationed: a new model is not urgent enough to start a process on every launch.
 */
const CHECK_INTERVAL_MS: number = 24 * 60 * 60 * 1000;

/**
 * Offers the user models their providers have started offering (#866).
 *
 * ⛔ Offers, never applies. A model list changes only when the user says so — **Add** on the
 * notification, or Discover in settings — and only ever gains. **Not now** is remembered, so the same
 * models are not offered again; a different new model is. Retiring a model is only a mark the picker
 * reads, so that is applied as soon as discovery shows it.
 *
 * Checks each configuration once its provider plugin is known — at start-up, and again whenever the
 * installed plugins change, which is how a plugin update arrives. Discovery runs at most once a day per
 * configuration, or at once when its plugin's version has changed; in between, a plugin that cannot
 * discover is still read for new models from its manifest.
 */
@Service()
export class ModelUpdates {
  /**
   * Holds the connections, which run the review and hold its outcome.
   */
  private readonly connections: AiConnections = inject(AiConnections);

  /**
   * Holds the installed providers, whose change is what triggers a check.
   */
  private readonly providers: AiProviders = inject(AiProviders);

  /**
   * Holds the plugin client, read for each harness's installed version.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Holds the notification store.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the offers made this session, as `connection:model,model`, so a re-check does not raise the
   * same toast while it is still showing or after it was closed without an answer.
   */
  private readonly offered: Set<string> = new Set<string>();

  /**
   * Holds the connections being checked, so overlapping triggers do not check one twice at once.
   */
  private readonly checking: Set<string> = new Set<string>();

  /**
   * Checks every configuration whenever the installed providers change.
   */
  private readonly watch: ReturnType<typeof effect> = effect((): void => {
    if (this.providers.contributed().length === 0 || !this.connections.isAvailable) {
      return;
    }
    untracked((): void => {
      for (const connection of this.connections.connections()) {
        void this.check(connection);
      }
    });
  });

  /**
   * Checks one configuration's models, and offers any that are new.
   * @param connection The configuration.
   * @returns Resolves once the check has settled.
   */
  public async check(connection: AiConnection): Promise<void> {
    const plugin: string | null = this.pluginOf(connection);
    if (plugin === null || this.checking.has(connection.id)) {
      return;
    }
    this.checking.add(connection.id);
    try {
      const last: AiConnection['modelCheck'] = connection.modelCheck;
      const due: boolean = last?.plugin !== plugin || Date.now() - last.at >= CHECK_INTERVAL_MS;
      if (!due && last?.discovered === true) {
        // Discovery answered within the day, and it is the only source when it answers.
        return;
      }
      const review: ConnectionReview | null = await this.connections.review(connection, {
        discover: due,
        includeDismissed: false,
      });
      if (review === null) {
        return;
      }
      if (due) {
        this.connections.markChecked(connection.id, {
          at: Date.now(),
          plugin,
          discovered: review.discovered !== null,
        });
      }
      this.connections.applyReview(connection.id, review.review);
      this.offer(connection, review.review.added);
    } catch (error: unknown) {
      this.log.warn('ModelUpdates', `Model check failed for '${connection.id}'`, error);
    } finally {
      this.checking.delete(connection.id);
    }
  }

  /**
   * Offers new models for a configuration, once per session for the same set.
   * @param connection The configuration.
   * @param added The new models.
   */
  private offer(connection: AiConnection, added: readonly AiModelInfo[]): void {
    if (added.length === 0) {
      return;
    }
    const ids: readonly string[] = added.map((model: AiModelInfo): string => model.id);
    const key: string = `${connection.id}:${ids.join(',')}`;
    if (this.offered.has(key)) {
      return;
    }
    this.offered.add(key);
    this.log.info('ModelUpdates', `Offering new models for '${connection.id}'`, ids.join(', '));
    this.notifications.notify({
      severity: 'info',
      title: `${connection.label} has ${added.length === 1 ? 'a new model' : `${added.length} new models`}`,
      detail: `${modelNames(added)}. Add ${added.length === 1 ? 'it' : 'them'} to the model picker?`,
      sticky: true,
      key: `new-models:${connection.id}`,
      actions: [
        { label: 'Add', run: (): void => this.connections.addModels(connection.id, added) },
        { label: 'Not now', run: (): void => this.connections.dismissModels(connection.id, ids) },
      ],
    });
  }

  /**
   * Names the installed plugin that runs a configuration, as `id@version`.
   * @param connection The configuration.
   * @returns Returns the plugin, or null when the configuration names none or it is not installed.
   */
  private pluginOf(connection: AiConnection): string | null {
    const harnessId: string | null | undefined = connection.harnessId;
    if (harnessId === undefined || harnessId === null) {
      return null;
    }
    const plugin: PluginSummary | undefined = this.plugins
      .plugins()
      .find(
        (candidate: PluginSummary): boolean =>
          candidate.state === 'installed' &&
          candidate.contributions.some(
            (contribution: PluginContribution): boolean =>
              contribution.slot === 'agent-harness' && contribution.id === harnessId,
          ),
      );
    return plugin === undefined
      ? null
      : `${plugin.id}@${plugin.installedVersion ?? plugin.version}`;
  }
}
