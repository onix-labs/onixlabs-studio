import { inject, Service } from '@angular/core';
import { DiffDocumentPanel } from '@shared/angular/components/panels/diff-document-panel/diff-document-panel';
import { Icon } from '@shared/angular/icons/icon';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { findPrimaryStack, firstStackOfRole } from '@shared/angular/services/dock-layout/dock-tree';
import { Log } from '@shared/angular/services/log/log';
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
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Opens (or re-activates) the diff for a changed file in the document well, loading its before/after
   * contents lazily through the repository's provider.
   * @param file The file to compare.
   */
  public open(file: GitFileChange): void {
    const id: string = this.diffs.idForPath(file.path);
    // The content is stored and the panel registered before the layout is touched, because a well
    // that has to be made is made holding this panel — by then it must resolve to something.
    this.diffs.put(id, file);
    if (!this.registry.has(id)) {
      this.registry.register({
        id,
        title: this.fileName(file.path),
        icon: Icon.GIT_DIFF,
        role: 'document',
        component: DiffDocumentPanel,
        // The panel draws its own strip. Without this the dock adds the well's stubbed editor tools
        // above it — Split Editor, Find in File — which a diff cannot do, over a strip of commands
        // it can.
        ownsToolStrip: true,
      });
    }

    const well: StackNode | null =
      firstStackOfRole(this.dockState.layout(), 'document') ?? this.makeWell(id);
    if (well === null) {
      this.log.warn('DiffOpener', `Nowhere to open the diff for '${file.path}'`);
      return;
    }
    this.log.info('DiffOpener', `Opened diff for '${file.path}'`);
    if (well.panels.includes(id)) {
      this.dockState.setActive(well.id, id);
    } else {
      this.dockState.tabInto(well.id, id);
    }
    this.dockFocus.focus(well.id);
    void this.repository.loadDiff(file).then((diff: FileDiff): void => {
      this.diffs.put(id, { ...file, original: diff.original, modified: diff.modified });
    });
  }

  /**
   * Opens the diff for a file named by its absolute path — what a tree row or an agent holds, rather
   * than a change from the repository's own lists. Only a file the repository reports as changed has a
   * diff; anything else is refused with the reason rather than opened as an empty comparison.
   *
   * The status is read once more before refusing. The explorers colour their rows from their own
   * status read, which can land a moment before this repository's, so a file just edited can be
   * offered a diff the lists here do not hold yet.
   * @param path The absolute path of the file.
   * @returns Returns null when the diff was opened, or the reason it could not be.
   */
  public async openPath(path: string): Promise<string | null> {
    if (!this.repository.isBound()) {
      return 'This workspace is not a git repository, so there is no diff to show.';
    }
    const relative: string = this.relativeToRoot(path);
    let change: GitFileChange | undefined = this.changeAt(relative);
    if (change === undefined) {
      await this.repository.refreshStatus();
      change = this.changeAt(relative);
    }
    if (change === undefined) {
      return `"${relative}" has no changes against HEAD, so there is no diff to show.`;
    }
    this.open(change);
    return null;
  }

  /**
   * Gets a path relative to the bound repository's root, with forward slashes — the form the
   * repository's change lists use.
   * @param path The absolute path.
   * @returns Returns the relative path, or the path unchanged when it is outside the root.
   */
  private relativeToRoot(path: string): string {
    const root: string = (this.repository.info()?.root ?? '').replace(/\\/g, '/');
    const slashed: string = path.replace(/\\/g, '/');
    return root.length > 0 && slashed.startsWith(`${root}/`)
      ? slashed.slice(root.length + 1)
      : slashed;
  }

  /**
   * Finds the working-tree change at a path, in any of the repository's change lists.
   * @param relative The path relative to the repository root.
   * @returns Returns the change, or undefined when the path has none.
   */
  private changeAt(relative: string): GitFileChange | undefined {
    return [
      ...this.repository.unstaged(),
      ...this.repository.staged(),
      ...this.repository.conflicted(),
    ].find((candidate: GitFileChange): boolean => candidate.path === relative);
  }

  /**
   * Makes a document well above the layout's centre slot, holding the given panel.
   *
   * A surface may reasonably have no well at all — the Git layout has none, since History is what it
   * is for and an empty well above it would be a permanent gap kept for a diff that may never be
   * asked for. The well is made the first time one is, so the space is spent only once it is earned.
   *
   * Above the centre rather than beside it: a diff is read against the history that produced it, and
   * a column keeps both full width.
   *
   * @param panelId The panel the new well opens holding.
   * @returns Returns the new well, or null when there is no centre slot to split.
   */
  private makeWell(panelId: string): StackNode | null {
    const centre: StackNode | null = findPrimaryStack(this.dockState.layout());
    if (centre === null) {
      return null;
    }
    this.log.info('DiffOpener', 'No document well in this layout; making one');
    this.dockState.splitStack(centre.id, panelId, 'top', 'document');
    return firstStackOfRole(this.dockState.layout(), 'document');
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
