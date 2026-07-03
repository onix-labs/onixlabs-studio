import { inject, Service } from '@angular/core';
import { DiffDocumentPanel } from '../../components/views/source-control-view/panels/diff-document-panel/diff-document-panel';
import { Icon } from '@shared/angular/icons/icon';
import { DockFocus } from '@shared/angular/services/dock/dock-focus';
import { DockPanelRegistry } from '@shared/angular/services/dock/dock-panel-registry';
import { DockState } from '@shared/angular/services/dock/dock-state';
import { StackNode } from '@shared/angular/services/dock/dock-node';
import { firstStackOfRole } from '@shared/angular/services/dock/dock-tree';
import { GitFileChange } from '@shared/angular/services/repository/repository-data';
import { Repository } from '@shared/angular/services/repository/repository';
import { FileDiff } from '@shared/angular/services/source-control/source-control-provider';
import { Diffs } from './diffs';

/**
 * Opens a changed file's diff into the source-control document well, reusing the tab when the file's
 * diff is already open. This is the diff analogue of
 * {@link import('../file-opener/file-opener').FileOpener}: it registers a document panel backed by
 * {@link DiffDocumentPanel} and tabs it into the well, while the {@link Diffs} store holds the content
 * the panel resolves. Kept separate from {@link Diffs} so the store never references a component.
 */
@Service()
export class DiffOpener {
  /**
   * Holds the diff content store the opened panel resolves from.
   */
  private readonly diffs: Diffs = inject(Diffs);

  /**
   * Holds the dock layout the document well lives in.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the dock focus tracker, so opening a diff accents its well.
   */
  private readonly dockFocus: DockFocus = inject(DockFocus);

  /**
   * Holds the dock panel registry diff panels are registered with.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Holds the repository the diff contents are loaded through.
   */
  private readonly repository: Repository = inject(Repository);

  /**
   * Opens (or re-activates) the diff for a changed file in the document well, loading its before/after
   * contents lazily through the repository's provider.
   * @param file The file to compare.
   */
  public open(file: GitFileChange): void {
    const well: StackNode | null = firstStackOfRole(this.dockState.layout(), 'document');
    if (well === null) {
      return;
    }
    const id: string = this.diffs.idForPath(file.path);
    // Store the file first (so a panel projected synchronously by tabInto resolves it), then fill in
    // its diff contents once the provider has loaded them.
    this.diffs.put(id, file);
    if (this.registry.has(id)) {
      this.dockState.setActive(well.id, id);
    } else {
      this.registry.register({
        id,
        title: this.fileName(file.path),
        icon: Icon.GIT_DIFF,
        role: 'document',
        component: DiffDocumentPanel,
      });
      this.dockState.tabInto(well.id, id);
    }
    this.dockFocus.focus(well.id);
    void this.repository.loadDiff(file).then((diff: FileDiff): void => {
      this.diffs.put(id, { ...file, original: diff.original, modified: diff.modified });
    });
  }

  /**
   * Gets the trailing file-name segment of a path, used as the diff tab's title.
   * @param path The full path.
   * @returns Returns the last path segment.
   */
  private fileName(path: string): string {
    const segments: readonly string[] = path.split('/');
    return segments[segments.length - 1] ?? path;
  }
}
