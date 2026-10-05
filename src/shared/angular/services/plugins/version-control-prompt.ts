import { computed, effect, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { DetectedRepository } from '@shared/api/source-control-channels';
import {
  installedContributions,
  PluginContribution,
  PluginSummary,
  slotCandidates,
} from '@shared/api/plugin-channels';
import { Log } from '@shared/angular/services/log/log';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { Plugins } from './plugins';

/**
 * Offers to install a version-control plugin when a workspace is a repository nothing installed can
 * read (#818) — a Studio with no Git plugin opening a Git repository.
 *
 * Studio runs no version-control tool of its own, so without a plugin a repository looks like a plain
 * folder. That is worse than an error: nothing says why the branch, the changes and the history are
 * missing. This is what says it — once as a notification when such a workspace opens, and as the
 * source-control panels' empty state for as long as it stays true.
 */
@Service()
export class VersionControlPrompt {
  /**
   * Holds the plugin client.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Holds the notifications service the offer is made through.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the repository that needs a plugin, or null when none does.
   */
  private readonly neededSignal: WritableSignal<DetectedRepository | null> =
    signal<DetectedRepository | null>(null);

  /**
   * Holds whether the offer has been made this session, so it is made once rather than per workspace.
   */
  private offered: boolean = false;

  /**
   * Gets whether any version-control plugin is installed.
   */
  public readonly isInstalled: Signal<boolean> = computed(
    (): boolean => installedContributions(this.plugins.plugins(), 'version-control').length > 0,
  );

  /**
   * Gets the repository an open workspace belongs to that no installed plugin can read, or null.
   */
  public readonly needed: Signal<DetectedRepository | null> = computed(
    (): DetectedRepository | null => (this.isInstalled() ? null : this.neededSignal()),
  );

  /**
   * Gets the plugins that could fill the slot, in catalogue order.
   */
  public readonly candidates: Signal<readonly PluginSummary[]> = computed(
    (): readonly PluginSummary[] =>
      slotCandidates(
        this.plugins.plugins(),
        (contribution: PluginContribution): boolean => contribution.slot === 'version-control',
      ),
  );

  /**
   * Initializes the prompt, re-arming the offer once a plugin is installed.
   */
  public constructor() {
    effect((): void => {
      if (this.isInstalled()) {
        this.offered = false;
      }
    });
  }

  /**
   * Records that an open workspace is a repository no installed plugin can read, and offers the
   * install once.
   * @param detected The repository and the plugin it needs.
   */
  public offer(detected: DetectedRepository): void {
    this.neededSignal.set(detected);
    if (this.offered || this.isInstalled()) {
      return;
    }
    const plugin: PluginSummary | undefined = this.pluginFor(detected);
    if (plugin === undefined) {
      return;
    }
    this.offered = true;
    this.log.info('VersionControlPrompt', `Offering ${plugin.id}`);
    this.notifications.notify({
      severity: 'info',
      title: `This folder is a ${detected.displayName} repository`,
      detail: `Install ${plugin.name} to see its changes, history and branches, or find it later under Plugins.`,
      key: 'version-control-support',
      // Sticky, because it asks the user to decide something.
      sticky: true,
      actions: [
        {
          label: `Install ${plugin.name}`,
          run: (): void => {
            void this.plugins.installWithConsent(plugin.id);
          },
        },
      ],
    });
  }

  /**
   * Clears the record of a repository needing a plugin — when the workspace closes or proves not to be
   * one.
   */
  public clear(): void {
    this.neededSignal.set(null);
  }

  /**
   * Installs the plugin the needed repository belongs to, through the same consent as the Plugin
   * Manager. Reached from the panels' empty state.
   * @returns Returns a promise that settles when the install does.
   */
  public install(): Promise<void> {
    const detected: DetectedRepository | null = this.needed();
    const plugin: PluginSummary | undefined =
      detected === null ? this.candidates()[0] : this.pluginFor(detected);
    if (plugin === undefined) {
      return Promise.resolve();
    }
    this.log.info('VersionControlPrompt', `Installing ${plugin.id} from the empty state`);
    return this.plugins.installWithConsent(plugin.id);
  }

  /**
   * Finds the catalogue entry providing the detected repository's plugin, else the first candidate.
   * @param detected The repository.
   * @returns Returns the plugin, or undefined when the catalogue offers none.
   */
  private pluginFor(detected: DetectedRepository): PluginSummary | undefined {
    const candidates: readonly PluginSummary[] = this.candidates();
    return (
      candidates.find((plugin: PluginSummary): boolean =>
        plugin.contributions.some(
          (contribution: PluginContribution): boolean => contribution.id === detected.pluginId,
        ),
      ) ?? candidates[0]
    );
  }
}
