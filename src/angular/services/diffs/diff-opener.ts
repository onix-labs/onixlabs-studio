import { inject, Service } from '@angular/core';
import { DiffDocumentPanel } from '../../components/views/source-control-view/panels/diff-document-panel/diff-document-panel';
import { Icon } from '../../icons/icon';
import { DockFocus } from '../dock/dock-focus';
import { DockPanelRegistry } from '../dock/dock-panel-registry';
import { DockState } from '../dock/dock-state';
import { StackNode } from '../dock/dock-node';
import { firstStackOfRole } from '../dock/dock-tree';
import { GitFileChange } from '../repository/repository-data';
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
   * Opens (or re-activates) the diff for a changed file in the document well.
   * @param file The file to compare.
   */
  public open(file: GitFileChange): void {
    const well: StackNode | null = firstStackOfRole(this.dockState.layout(), 'document');
    if (well === null) {
      return;
    }
    const id: string = this.diffs.idForPath(file.path);
    // Keep the store current first, so a panel projected synchronously by tabInto resolves its file.
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
