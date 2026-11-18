import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RepositoryTrust } from '@shared/angular/services/repository-trust/repository-trust';
import { RepositoryTrustModal } from './repository-trust-modal';

/**
 * Mounts the trust question at the application root, bound to the {@link RepositoryTrust} service
 * (#1504). The main process owns the question and asks it here, one folder at a time; this only shows
 * it and sends back the answer.
 */
@Component({
  selector: 'app-repository-trust-host',
  imports: [RepositoryTrustModal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-repository-trust-modal
      [question]="trust.pending()"
      (accepted)="trust.answer('trusted')"
      (declined)="trust.answer('restricted')"
      (scanned)="trust.answer('scan')"
      (deferred)="trust.answer('later')"
      (cancelled)="trust.answer('cancel')"
    />
  `,
})
export class RepositoryTrustHost {
  /**
   * Holds the trust service whose pending question this host renders.
   */
  protected readonly trust: RepositoryTrust = inject(RepositoryTrust);
}
