import { effect, inject, Injector, Service, untracked } from '@angular/core';
import { DiffDocumentPanel } from '@shared/angular/components/panels/diff-document-panel/diff-document-panel';
import { Icon } from '@shared/angular/icons/icon';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { OpenOptions } from '@shared/angular/services/tabs/tab';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { DockNode, isStackNode, StackNode } from '@shared/angular/services/dock-layout/dock-node';
import {
  findNode,
  findPrimaryStack,
  findStackOfPanel,
  firstStackOfRole,
} from '@shared/angular/services/dock-layout/dock-tree';
import { Log } from '@shared/angular/services/log/log';
import { GitFileChange } from '@shared/angular/services/repository/repository-data';
import { Repository } from '@shared/angular/services/repository/repository';
import { FileDiff } from '@shared/angular/services/source-control/source-control-provider';
import { Diffs } from './diffs';
import { DocumentDiffSwitch } from './document-diff-switch';

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
   * Holds the injector the diff-to-file switch is resolved from as a panel is registered.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds, by diff id, the latest content read started for an open working-tree diff, so a read that
   * a later one overtook is dropped rather than painting older content over newer.
   */
  private readonly reads: Map<string, number> = new Map<string, number>();

  /**
   * Holds the number the next content read is given.
   */
  private nextRead: number = 0;

  /**
   * Follows the repository's change lists with the working-tree diffs open, so none goes on showing
   * a change that has since been edited, staged or committed.
   */
  public constructor() {
    let first: boolean = true;
    effect((): void => {
      this.repository.staged();
      this.repository.unstaged();
      this.repository.conflicted();
      // The first run is the lists as they stood when this opener was made; only a change is news.
      if (first) {
        first = false;
        return;
      }
      untracked((): void => this.followWorkingDiffs());
    });
  }

  /**
   * Opens (or re-activates) the diff for a changed file in the document well, loading its before/after
   * contents lazily through the repository's provider. A diff already open in another well is gone
   * to there.
   * @param file The file to compare.
   * @param wellId The document well to open it in — the one a switch from the file's tab came from —
   * or omitted for the layout's first.
   * @param options How to open it; in the background, it goes in behind the well's active document
   * and the well is not focused.
   */
  public open(file: GitFileChange, wellId?: string, options?: OpenOptions): void {
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
        // Resolved here rather than injected: the switch reaches back to this opener.
        switch: this.injector.get(DocumentDiffSwitch).forDiff(id),
      });
    }

    const layout: DockNode = this.dockState.layout();
    const asked: DockNode | null = wellId === undefined ? null : findNode(layout, wellId);
    const open: StackNode | null = findStackOfPanel(layout, id);
    const well: StackNode | null =
      (open?.role === 'document' ? open : null) ??
      (asked !== null && isStackNode(asked) && asked.role === 'document' ? asked : null) ??
      firstStackOfRole(layout, 'document') ??
      this.makeWell(id);
    if (well === null) {
      this.log.warn('DiffOpener', `Nowhere to open the diff for '${file.path}'`);
      return;
    }
    this.log.info('DiffOpener', `Opened diff for '${file.path}'`);
    const background: boolean = options?.background === true;
    if (well.panels.includes(id)) {
      if (!background) {
        this.dockState.setActive(well.id, id);
      }
    } else {
      this.dockState.tabInto(well.id, id, options);
    }
    if (!background) {
      this.dockFocus.focus(well.id);
    }
    this.load(id, file);
  }

  /**
   * Brings every open working-tree diff up to date with the repository's change lists: one whose file
   * still has a change reads its contents afresh, and one whose file has none left — committed, or
   * put back as it was — closes, since there is nothing left to compare. A commit's diff is history
   * and stays as it is.
   */
  private followWorkingDiffs(): void {
    if (!this.repository.isBound()) {
      return;
    }
    for (const id of this.diffs.ids()) {
      const shown: GitFileChange | null = this.diffs.get(id);
      const target: GitFileChange['target'] = shown?.target;
      if (shown === null || target?.kind !== 'working') {
        continue;
      }
      const current: GitFileChange | undefined = this.workingChange(shown.path, target.staged);
      if (current === undefined) {
        this.log.info('DiffOpener', `'${shown.path}' has no changes left; closing its diff`);
        this.reads.delete(id);
        this.dockState.removeFromLayout(id);
        continue;
      }
      // What is on screen stays there until the fresh contents land, rather than blanking meanwhile.
      this.load(id, { ...current, original: shown.original, modified: shown.modified });
    }
  }

  /**
   * Finds a file's working-tree change, preferring the side — index or working tree — its diff
   * already shows: a file partly staged has a change on both.
   * @param path The path relative to the repository root.
   * @param staged Whether the diff shows the staged side.
   * @returns Returns the change, or undefined when the file has none.
   */
  private workingChange(path: string, staged: boolean): GitFileChange | undefined {
    const preferred: readonly GitFileChange[] = staged
      ? this.repository.staged()
      : this.repository.unstaged();
    const other: readonly GitFileChange[] = staged
      ? this.repository.unstaged()
      : this.repository.staged();
    return [...preferred, ...this.repository.conflicted(), ...other].find(
      (candidate: GitFileChange): boolean => candidate.path === path,
    );
  }

  /**
   * Shows a change in its diff and reads its before/after contents through the repository's provider,
   * filling them in once they arrive — unless a later read for the same diff started meanwhile, or the
   * diff was closed or moved to the file's other side.
   * @param id The diff id.
   * @param file The change to show.
   */
  private load(id: string, file: GitFileChange): void {
    const read: number = ++this.nextRead;
    this.reads.set(id, read);
    this.diffs.put(id, file);
    void this.repository.loadDiff(file).then((diff: FileDiff): void => {
      const shown: GitFileChange | null = this.diffs.get(id);
      if (this.reads.get(id) !== read || shown === null || !sameSide(shown, file)) {
        return;
      }
      if (shown.original === diff.original && shown.modified === diff.modified) {
        return;
      }
      this.diffs.put(id, { ...shown, original: diff.original, modified: diff.modified });
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
   * @param wellId The document well to open it in, or omitted for the layout's first.
   * @param options How to open it.
   * @returns Returns null when the diff was opened, or the reason it could not be.
   */
  public async openPath(
    path: string,
    wellId?: string,
    options?: OpenOptions,
  ): Promise<string | null> {
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
    this.open(change, wellId, options);
    return null;
  }

  /**
   * Gets the working-tree change of a file named by its absolute path, from the repository's change
   * lists as they stand — read inside a reactive context, it follows them.
   * @param path The absolute path of the file.
   * @returns Returns the change, or undefined when the file has none.
   */
  public changeForPath(path: string): GitFileChange | undefined {
    return this.changeAt(this.relativeToRoot(path));
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
   * Makes a document well beside the layout's centre slot, holding the given panel.
   *
   * A surface may reasonably have no well at all — the Git layout has none, since History is what it
   * is for and an empty well above it would be a permanent gap kept for a diff that may never be
   * asked for. The well is made the first time one is, so the space is spent only once it is earned.
   *
   * Above the centre when the centre is History: a diff is read against the history that produced it,
   * and a column keeps both full width. Anything else in the centre — the agent, in the agentic
   * layout — gets the well beside it, as a file opened there would, so the two read side by side.
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
    if (centre.panels.includes('history')) {
      this.dockState.splitStack(centre.id, panelId, 'top', 'document');
    } else {
      this.dockState.openWellBeside(centre.id, panelId);
    }
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

/**
 * Determines whether two changes show the same file from the same side — the same commit, or the same
 * one of the index and the working tree — so contents read for one belong to the other.
 * @param left The one change.
 * @param right The other change.
 * @returns Returns true when both show the same file from the same side.
 */
function sameSide(left: GitFileChange, right: GitFileChange): boolean {
  const a: GitFileChange['target'] = left.target;
  const b: GitFileChange['target'] = right.target;
  if (left.path !== right.path || a?.kind !== b?.kind) {
    return false;
  }
  if (a?.kind === 'working' && b?.kind === 'working') {
    return a.staged === b.staged;
  }
  if (a?.kind === 'commit' && b?.kind === 'commit') {
    return a.hash === b.hash;
  }
  return true;
}
