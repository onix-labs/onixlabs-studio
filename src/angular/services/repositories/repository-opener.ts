import { inject, Service } from '@angular/core';
import { RepositoryInfo, SourceControlApi } from '../../../shared/studio-api';
import { Tab } from '../tabs/tab';
import { Tabs } from '../tabs/tabs';
import { Repositories } from './repositories';

/**
 * Opens a git repository into a new source-control tab. It mirrors
 * {@link import('../file-opener/file-opener').FileOpener}'s folder flow: the main process shows the
 * open dialog and resolves the chosen folder's repository root, then a source-control tab is created,
 * named after the repository, and handed the root to bind on init.
 */
@Service()
export class RepositoryOpener {
  /**
   * Holds the git bridge, or undefined when running outside Electron.
   */
  private readonly api: SourceControlApi | undefined = window.studio?.sourceControl;

  /**
   * Holds the top-level tab registry.
   */
  private readonly tabs: Tabs = inject(Tabs);

  /**
   * Holds the registry that hands the opened repository to its tab's view.
   */
  private readonly repositories: Repositories = inject(Repositories);

  /**
   * Shows the open-repository dialog and, when a git repository is chosen, opens it in a new tab.
   * @returns Returns true when a repository was opened, or false when cancelled or not a repository.
   */
  public async openInteractive(): Promise<boolean> {
    const info: RepositoryInfo | null = await (this.api?.openRepository() ?? Promise.resolve(null));
    if (info === null) {
      return false;
    }
    this.open(info);
    return true;
  }

  /**
   * Resolves the git repository containing a folder and, when found, opens it in a new tab. Used to
   * open the repository of an already-open workspace folder.
   * @param directory The absolute folder path to resolve from.
   * @returns Returns true when a repository was opened, or false when the folder is not a repository.
   */
  public async openFolder(directory: string): Promise<boolean> {
    const info: RepositoryInfo | null = await (this.api?.resolveRepository(directory) ??
      Promise.resolve(null));
    if (info === null) {
      return false;
    }
    this.open(info);
    return true;
  }

  /**
   * Opens a resolved repository in a new source-control tab, naming the tab and stashing the
   * repository for the tab's view to bind on init.
   * @param info The opened repository's metadata.
   */
  private open(info: RepositoryInfo): void {
    const existing: Tab | undefined = this.tabs.findByResource('source-control', info.root);
    if (existing !== undefined) {
      this.tabs.activate(existing.id);
      return;
    }
    const tab: Tab = this.tabs.open('source-control', info.root);
    this.tabs.rename(tab.id, info.name);
    this.repositories.setInitial(tab.id, info);
  }
}
