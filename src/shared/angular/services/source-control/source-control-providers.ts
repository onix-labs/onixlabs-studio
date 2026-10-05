import { inject, Service } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { SourceControl } from '@shared/angular/services/source-control/source-control';
import { VersionControlProvider } from './version-control-provider';
import { SourceControlProvider } from './source-control-provider';

/**
 * Creates a {@link SourceControlProvider} for an opened repository root. Every provider is the same
 * proxy over the version-control protocol: which system answers — Git, or any other installed plugin
 * — is decided in the main process from the repository itself (#816). Injected by the
 * {@link import('../repository/repository').Repository} so a test can substitute a fake provider.
 */
@Service()
export class SourceControlProviders {
  /**
   * Holds the source-control client shared by every provider this factory creates.
   */
  private readonly sourceControl: SourceControl = inject(SourceControl);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Creates a provider for a repository root.
   * @param root The repository's absolute root path.
   * @returns Returns the provider bound to the root.
   */
  public create(root: string): SourceControlProvider {
    this.log.debug('SourceControlProviders', 'Creating version-control provider', root);
    return new VersionControlProvider(root, this.sourceControl.client);
  }
}
