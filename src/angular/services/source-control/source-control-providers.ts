import { inject, Service } from '@angular/core';
import { SourceControl } from '@shared/angular/services/source-control/source-control';
import { GitProvider } from './git-provider';
import { SourceControlProvider } from './source-control-provider';

/**
 * Creates a {@link SourceControlProvider} for an opened repository root. This is the renderer entry to
 * the version-control adapter: it returns a git provider today, and is the single place a future
 * backend (for example SVN, selected by inspecting the root) would be chosen. Injected by the
 * {@link import('../repository/repository').Repository} so a test can substitute a fake provider.
 */
@Service()
export class SourceControlProviders {
  /**
   * Holds the source-control client shared by every git provider this factory creates.
   */
  private readonly sourceControl: SourceControl = inject(SourceControl);

  /**
   * Creates a provider for a repository root.
   * @param root The repository's absolute root path.
   * @returns Returns the provider bound to the root.
   */
  public create(root: string): SourceControlProvider {
    return new GitProvider(root, this.sourceControl.client);
  }
}
