import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Tabs } from '@shared/angular/services/tabs/tabs';

/**
 * The deep-link seam for the Settings tab. The Settings tab is a singleton whose section navigation is
 * internal state; a button elsewhere in the app that wants to land the user on a specific section (for
 * example Mission Control's gear opening the Mission Control category) records the target here and opens
 * the tab, and the settings view consumes the request once it has applied it. This works whether the
 * tab is already open or opened by the same call.
 */
@Service()
export class SettingsNavigation {
  /**
   * Holds the tab registry, used to open (or activate) the singleton Settings tab.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the section the settings view should switch to on its next read, or null when none is
   * pending. The section is an opaque string here so this shared seam does not depend on the settings
   * feature's section-id union; the view validates it.
   */
  private readonly requested: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the pending target section for the settings view to consume, or null when none is pending.
   */
  public readonly requestedSection: Signal<string | null> = this.requested.asReadonly();

  /**
   * Opens the Settings tab and requests that it show the given section. If the tab is already open it
   * is activated; either way the view picks up the request and switches section.
   * @param section The identifier of the section to show.
   */
  public open(section: string): void {
    this.requested.set(section);
    this.tabs.open('settings');
    this.log.info('SettingsNavigation', `Opened Settings at section '${section}'`);
  }

  /**
   * Clears the pending section request. Called by the settings view once it has applied the request, so
   * a later manual section change is not overridden.
   */
  public consume(): void {
    this.requested.set(null);
  }
}
