import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PluginConsent } from '@shared/angular/services/plugins/plugin-consent';
import { PluginBatchConsentModal } from './plugin-batch-consent-modal';
import { PluginConsentModal } from './plugin-consent-modal';

/**
 * Mounts the plugin consent terms at the application root, bound to the {@link PluginConsent}
 * service, so whichever surface asks — the Plugin Manager, a notification — the same window opens
 * with the same terms, and there is exactly one of it. Update All's single question for several
 * updates (#1451) is mounted here too, so it shares the same one-question-at-a-time rule.
 */
@Component({
  selector: 'app-plugin-consent-host',
  imports: [PluginConsentModal, PluginBatchConsentModal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-plugin-consent-modal
      [plugin]="consent.pending()"
      (accepted)="consent.accept()"
      (declined)="consent.decline()"
    />
    <app-plugin-batch-consent-modal
      [plugins]="consent.pendingBatch()"
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
