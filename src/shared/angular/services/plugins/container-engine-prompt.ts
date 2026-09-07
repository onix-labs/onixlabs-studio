import { computed, effect, inject, Service, Signal } from '@angular/core';
import { installedContributions, PluginSummary } from '@shared/api/plugin-channels';
import { Log } from '@shared/angular/services/log/log';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { Plugins } from './plugins';

/**
 * Offers to install a container engine at the moment one is missed.
 *
 * The third sibling of {@link import('./language-support-prompt').LanguageSupportPrompt} and
 * {@link import('./decoder-support-prompt').DecoderSupportPrompt}, and the simplest of the three,
 * because a container engine is keyed by nothing: there is no language and no format to ask about, so
 * it asks once per session rather than once per key.
 *
 * The gap it fills is the one #596 and #597 create. Once the built-in engines leave core, opening the
 * Containers tab on a fresh installation shows nothing at all, and "nothing is running" would be the
 * wrong thing to say — nothing is *installed*, which is a different problem with a different fix.
 */
@Service()
export class ContainerEnginePrompt {
  /**
   * Holds the plugin client the offer reads and installs through.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Holds the notification surface the offer is raised on.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds whether the offer has already been made this session, so opening the Containers tab twice
   * raises one offer rather than two. Cleared once an engine is installed, so a later uninstall can
   * offer afresh.
   */
  private offered: boolean = false;

  /**
   * Gets whether an installed plugin contributes a container engine.
   */
  public readonly isInstalled: Signal<boolean> = computed(
    (): boolean => installedContributions(this.plugins.plugins(), 'container-engine').length > 0,
  );

  /**
   * Gets the plugins that would provide a container engine but are not installed, in catalogue order.
   */
  public readonly candidates: Signal<readonly PluginSummary[]> = computed(
    (): readonly PluginSummary[] =>
      this.plugins
        .plugins()
        .filter(
          (plugin: PluginSummary): boolean =>
            plugin.state !== 'installed' && this.contributesAnEngine(plugin),
        ),
  );

  /**
   * Initializes the prompt, forgetting the offer the moment an engine is installed — the offer did its
   * job, and the next time there is no engine is a new event.
   */
  public constructor() {
    effect((): void => {
      if (this.isInstalled()) {
        this.offered = false;
      }
    });
  }

  /**
   * Offers to install a container engine, when a plugin provides one and none is installed. Does nothing
   * when an engine is already installed, none is offered, or the offer has been made this session.
   */
  public offer(): void {
    if (this.offered || this.isInstalled()) {
      return;
    }
    const candidates: readonly PluginSummary[] = this.candidates();
    if (candidates.length === 0) {
      return;
    }
    // Offer exactly one — the first the catalogue lists, which is the default engine. Offering a choice
    // here would be asking the user to compare two things they have not installed; choosing between
    // engines belongs in the Containers surface, once more than one is installed.
    const plugin: PluginSummary = candidates[0];
    this.offered = true;
    this.log.info('ContainerEnginePrompt', `Offering ${plugin.id}`);
    this.notifications.notify({
      severity: 'info',
      title: 'No container engine is installed',
      detail: `${plugin.name} provides one. Install it now, or find it later under Plugins.`,
      key: 'container-engine-support',
      // Sticky, because this asks the user to decide something. A transient toast would expire while
      // the pointer was still on its way to the button.
      sticky: true,
      actions: [
        {
          label: `Install ${plugin.name}`,
          run: (): void => {
            // Through the same terms as the Plugin Manager: a notification is another entry point to
            // an install, not a shortcut past the question.
            void this.plugins.installWithConsent(plugin.id);
          },
        },
      ],
    });
  }

  /**
   * Installs the engine the empty state offers, which is the same one {@link offer} would raise.
   * @returns Returns a promise that resolves once the install settles, or immediately when there is
   * nothing to install.
   */
  public installFirstCandidate(): Promise<void> {
    const plugin: PluginSummary | undefined = this.candidates()[0];
    if (plugin === undefined) {
      return Promise.resolve();
    }
    this.log.info('ContainerEnginePrompt', `Installing ${plugin.id} from the empty state`);
    return this.plugins.installWithConsent(plugin.id);
  }

  /**
   * Gets whether a plugin contributes a container engine.
   * @param plugin The plugin to test.
   * @returns Returns true when it does.
   */
  private contributesAnEngine(plugin: PluginSummary): boolean {
    return plugin.contributions.some(
      (contribution): boolean => contribution.slot === 'container-engine',
    );
  }
}
