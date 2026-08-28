import { effect, inject, Service } from '@angular/core';
import { PluginContribution, PluginSlot, PluginSummary } from '@shared/api/plugin-channels';
import { Log } from '@shared/angular/services/log/log';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { languageDisplayName } from './language-names';
import { Plugins } from './plugins';

/**
 * Offers to install language support at the moment it is missed.
 *
 * Every language server is a plugin the user installs, which is the point — but it leaves a new
 * installation opening a TypeScript file to nothing at all, with no hint that anything is available or
 * where to find it. Rather than weaken the model by installing something unasked, this offers the
 * install exactly where the gap is felt: open a file whose language has a plugin nobody has installed,
 * and a notification says so and installs it in one click.
 *
 * It asks once per language per session. A user who declines is not asked again while the window
 * lives, so a project full of `.py` files raises one offer, not one per file.
 */
@Service()
export class LanguageSupportPrompt {
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
   * Holds the languages already offered this session, so a workspace full of one language raises a
   * single offer rather than one per file opened. A language is forgotten again once support for it
   * is installed, so a later uninstall can offer it afresh.
   */
  private readonly offered: Set<string> = new Set<string>();

  /**
   * Initializes the prompt, forgetting an offered language the moment a plugin serving it becomes
   * installed — the offer did its job, and the next time the language is unserved is a new event.
   */
  public constructor() {
    effect((): void => {
      const all: readonly PluginSummary[] = this.plugins.plugins();
      for (const language of [...this.offered]) {
        const served: boolean = all.some(
          (plugin: PluginSummary): boolean =>
            plugin.state === 'installed' &&
            plugin.contributions.some(
              (contribution: PluginContribution): boolean =>
                contribution.slot === 'language-server' &&
                contribution.languages.includes(language),
            ),
        );
        if (served) {
          this.offered.delete(language);
        }
      }
    });
  }

  /**
   * Offers to install language support for a language, when a plugin provides it and none is installed.
   * Does nothing when the language already has support, has no plugin, or has been offered already.
   * @param language The Monaco language identifier of the document that found no server.
   */
  public offerFor(language: string): void {
    if (this.offered.has(language)) {
      return;
    }
    const candidates: readonly PluginSummary[] = this.uninstalledFor(language, 'language-server');
    if (candidates.length === 0) {
      return;
    }
    // Offer exactly one — the first the catalogue lists, which is the default implementation for the
    // language. Offering a choice here would be asking the user to compare two things they have not
    // installed; choosing between implementations belongs in Settings, once both are installed.
    const plugin: PluginSummary = candidates[0];
    this.offered.add(language);
    this.log.info('LanguageSupportPrompt', `Offering ${plugin.id} for '${language}'`);
    this.notifications.notify({
      severity: 'info',
      title: `${languageDisplayName(language)} support isn't installed`,
      detail: `${plugin.name} provides it. Install it now, or find it later under Plugins.`,
      key: `language-support:${language}`,
      // Sticky, because this asks the user to decide something. Toasts are transient by default and
      // last five seconds, which is long enough to read an outcome and far too short to reach for a
      // button — the offer would expire while the pointer was on its way to it.
      sticky: true,
      actions: [
        {
          label: `Install ${plugin.name}`,
          run: (): void => {
            void this.plugins.install(plugin.id);
          },
        },
      ],
    });
  }

  /**
   * Gets the plugins that would provide a slot for a language but are not installed. Returns nothing
   * when the language already has an installed implementation, so support that exists is never
   * advertised again.
   * @param language The language identifier.
   * @param slot The slot to look for.
   * @returns Returns the uninstalled plugins providing the language, in catalogue order.
   */
  private uninstalledFor(language: string, slot: PluginSlot): readonly PluginSummary[] {
    const serves: (plugin: PluginSummary) => boolean = (plugin: PluginSummary): boolean =>
      plugin.contributions.some(
        (contribution: PluginContribution): boolean =>
          contribution.slot === slot && contribution.languages.includes(language),
      );
    const all: readonly PluginSummary[] = this.plugins.plugins();
    const installed: boolean = all.some(
      (plugin: PluginSummary): boolean => plugin.state === 'installed' && serves(plugin),
    );
    if (installed) {
      return [];
    }
    return all.filter(
      (plugin: PluginSummary): boolean => plugin.state === 'available' && serves(plugin),
    );
  }
}
