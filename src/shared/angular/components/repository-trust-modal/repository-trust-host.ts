import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RepositoryTrust } from '@shared/angular/services/repository-trust/repository-trust';
import { RepositoryTrustModal } from './repository-trust-modal';

/**
 * Mounts the repository trust question at the application root, bound to the
 * {@link RepositoryTrust} service, so whichever surface opens a repository — the explorer's
 * decorations, the Repository panel — the same window asks, and there is exactly one of it.
 */
@Component({
  selector: 'app-repository-trust-host',
  imports: [RepositoryTrustModal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-repository-trust-modal
      [question]="trust.pending()"
      (accepted)="trust.accept()"
      (declined)="trust.decline()"
    />
  `,
})
export class RepositoryTrustHost {
  /**
   * Holds the trust service whose pending question this host renders.
   */
  protected readonly trust: RepositoryTrust = inject(RepositoryTrust);
}
