import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PluginConsent } from '@shared/angular/services/plugins/plugin-consent';
import { PluginConsentModal } from './plugin-consent-modal';

/**
 * Mounts the plugin consent terms at the application root, bound to the {@link PluginConsent}
 * service, so whichever surface asks — the Plugin Manager, a notification — the same window opens
 * with the same terms, and there is exactly one of it.
 */
@Component({
  selector: 'app-plugin-consent-host',
  imports: [PluginConsentModal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-plugin-consent-modal
      [plugin]="consent.pending()"
      (accepted)="consent.accept()"
      (declined)="consent.decline()"
    />
  `,
})
export class PluginConsentHost {
  /**
   * Holds the consent service whose pending question this host renders.
   */
  protected readonly consent: PluginConsent = inject(PluginConsent);
}
