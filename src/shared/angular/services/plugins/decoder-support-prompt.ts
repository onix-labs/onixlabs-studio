import { computed, effect, inject, Service, Signal } from '@angular/core';
import { FormatPluginContribution, PluginSummary } from '@shared/api/plugin-channels';
import { installedContributions } from '@shared/api/plugin-channels';
import { Log } from '@shared/angular/services/log/log';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { Plugins } from './plugins';

/**
 * Offers to install a decoder at the moment one is missed.
 *
 * Studio ships no decoder of its own — not even for native machine code — so a new installation opening
 * a binary gets no listing at all until one is installed. That is the delivery model working as
 * intended, but on its own it leaves the user staring at an empty panel with no hint that anything
 * exists. Rather than weaken the model by installing something unasked, this offers the install exactly
 * where the gap is felt.
 *
 * The sibling of {@link import('./language-support-prompt').LanguageSupportPrompt}, keyed by binary
 * format rather than by language, and deliberately the same shape: it asks once per format per session,
 * and a user who declines is not asked again while the window lives — so a directory full of `.class`
 * files raises one offer, not one per file.
 */
@Service()
export class DecoderSupportPrompt {
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
   * Holds the formats already offered this session. A format is forgotten again once a decoder for it
   * is installed, so a later uninstall can offer it afresh.
   */
  private readonly offered: Set<string> = new Set<string>();

  /**
   * Holds the format keys an installed decoder covers, so the panel can ask without repeating the join.
   */
  private readonly installedFormats: Signal<ReadonlySet<string>> = computed(
    (): ReadonlySet<string> =>
      new Set<string>(
        installedContributions(this.plugins.plugins(), 'decoder').flatMap(
          (contribution: FormatPluginContribution): readonly string[] => contribution.formats,
        ),
      ),
  );

  /**
   * Initializes the prompt, forgetting an offered format the moment a decoder for it is installed — the
   * offer did its job, and the next time the format is undecoded is a new event.
   */
  public constructor() {
    effect((): void => {
      const covered: ReadonlySet<string> = this.installedFormats();
      for (const format of [...this.offered]) {
        if (covered.has(format)) {
          this.offered.delete(format);
        }
      }
    });
  }

  /**
   * Gets whether an installed decoder covers a format.
   * @param format The canonical format key.
   * @returns Returns true when a decoder for the format is installed.
   */
  public isCovered(format: string): boolean {
    return this.installedFormats().has(format);
  }

  /**
   * Gets whether any plugin offers a decoder for a format, installed or not — so a caller can tell
   * "nothing exists for this" from "something exists and is not installed".
   * @param format The canonical format key.
   * @returns Returns true when some plugin contributes a decoder for the format.
   */
  public isOffered(format: string): boolean {
    return this.plugins
      .plugins()
      .some((plugin: PluginSummary): boolean => this.contributes(plugin, format));
  }

  /**
   * Offers to install a decoder for a format, when a plugin provides one and none is installed. Does
   * nothing when the format is already covered, has no plugin, or has been offered already.
   * @param format The canonical format key of the binary that found no decoder.
   * @param description The format's display name, for the notification text.
   */
  public offerFor(format: string, description: string): void {
    if (this.offered.has(format) || this.isCovered(format)) {
      return;
    }
    const candidates: readonly PluginSummary[] = this.plugins
      .plugins()
      .filter((plugin: PluginSummary): boolean => this.contributes(plugin, format));
    if (candidates.length === 0) {
      return;
    }
    // Offer exactly one — the first the catalogue lists, which is the default for the format. Offering
    // a choice here would be asking the user to compare two things they have not installed; choosing
    // between decoders belongs in Settings, once both are installed.
    const plugin: PluginSummary = candidates[0];
    this.offered.add(format);
    this.log.info('DecoderSupportPrompt', `Offering ${plugin.id} for '${format}'`);
    this.notifications.notify({
      severity: 'info',
      title: `No decoder installed for ${description}`,
      detail: `${plugin.name} decodes it. Install it now, or find it later under Plugins.`,
      key: `decoder-support:${format}`,
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
   * Gets whether an uninstalled plugin contributes a decoder for a format.
   * @param plugin The plugin to test.
   * @param format The canonical format key.
   * @returns Returns true when the plugin decodes the format and is not installed.
   */
  private contributes(plugin: PluginSummary, format: string): boolean {
    return (
      plugin.state !== 'installed' &&
      plugin.contributions.some(
        (contribution): boolean =>
          contribution.slot === 'decoder' && contribution.formats.includes(format),
      )
    );
  }
}
