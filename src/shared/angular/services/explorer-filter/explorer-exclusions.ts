import {
  computed,
  effect,
  inject,
  Service,
  Signal,
  signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import {
  excludedFileGlobs,
  isExcludedPath,
  isHiddenPath,
  normaliseExcludedFile,
} from '../../../api/excluded-files';
import type { TreeRow } from '../../components/tree-view/tree-view';
import { StudioConfig } from '../studio/studio-config';
import { Workspace } from '../workspace/workspace';
import { RememberedSwitch } from './remembered-switch';

/**
 * How an excluded entry's row looks while hidden things show: muted, saying why.
 */
export const EXCLUDED_ROW_FIELDS: Pick<TreeRow, 'tone' | 'hint'> = {
  tone: 'muted',
  hint: 'Excluded from the explorers, Expand All and Find',
};

/**
 * One workspace tab's excluded files and folders (#1252), and whether its explorers show hidden
 * things. The list is the workspace's own, kept in its `.studio/workspace.json`; the explorers, Expand All
 * and Find all read it from here, so excluding a folder takes it out of each of them at once.
 *
 * Scoped per directory tab, beside the {@link Workspace} it reads, and provided nowhere else: a
 * search outside a workspace tab has no list to leave out.
 */
@Service({ autoProvided: false })
export class ExplorerExclusions {
  /**
   * Holds the tab's workspace, whose root the paths are relative to.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the `.studio` store the list is read from and written to.
   */
  private readonly studio: StudioConfig = inject(StudioConfig);

  /**
   * Holds the list as last read or written for each root the tab has had open, used while another
   * workspace is the focused one (or the focused one's snapshot is still loading). Keyed by root, so a
   * load finishing after an edit never overwrites the edit.
   */
  private readonly cached: WritableSignal<ReadonlyMap<string, readonly string[]>> = signal<
    ReadonlyMap<string, readonly string[]>
  >(new Map<string, readonly string[]>());

  /**
   * Holds whether the explorers show hidden things: dotfiles and dot-folders, and the excluded entries,
   * greyed so they can be included again. On by default, as dotfiles always showed before they could be
   * hidden.
   */
  private readonly hiddenVisible: RememberedSwitch = new RememberedSwitch(
    'workspace.files.showHidden',
    true,
  );

  /**
   * Gets the open root's absolute path, or null when no folder is open.
   */
  private readonly rootPath: Signal<string | null> = computed(
    (): string | null => this.workspace.root()?.path ?? null,
  );

  /**
   * Gets the excluded paths, relative to the workspace root. The focused workspace's loaded snapshot
   * wins, so an edit to `workspace.json` on disk shows at once.
   */
  public readonly paths: Signal<readonly string[]> = computed((): readonly string[] => {
    const root: string | null = this.rootPath();
    if (root !== null && this.studio.loadedRoot() === root) {
      return this.studio.excludedFiles();
    }
    return root === null ? [] : (this.cached().get(root) ?? []);
  });

  /**
   * Gets whether the explorers show hidden things: dotfiles, and excluded entries greyed.
   */
  public readonly showsHidden: Signal<boolean> = this.hiddenVisible.on;

  /**
   * Gets the ripgrep globs that leave the excluded paths out of a search.
   */
  public readonly searchGlobs: Signal<readonly string[]> = computed((): readonly string[] =>
    excludedFileGlobs(this.paths()),
  );

  /**
   * Loads the list whenever the tab's root changes, and has Expand All leave excluded folders, and
   * hidden ones while they are hidden, closed.
   */
  public constructor() {
    effect((): void => {
      const root: string | null = this.rootPath();
      if (root !== null && !untracked(this.cached).has(root)) {
        void this.studio.loadExcludedFiles(root).then((paths: readonly string[]): void => {
          if (!this.cached().has(root)) {
            this.remember(root, paths);
          }
        });
      }
    });
    this.workspace.setExpandSkip(
      (path: string): boolean =>
        this.isExcluded(path) || (!this.showsHidden() && this.isHidden(path)),
    );
  }

  /**
   * Determines whether an entry is excluded: it is listed, or it sits inside a listed folder.
   * @param path The entry's absolute path.
   * @returns Returns true when the entry is excluded.
   */
  public isExcluded(path: string): boolean {
    const relative: string | null = this.relative(path);
    return relative !== null && isExcludedPath(relative, this.paths());
  }

  /**
   * Determines whether an entry can be excluded at all: it lies inside the workspace root.
   * @param path The entry's absolute path.
   * @returns Returns true when it can.
   */
  public canExclude(path: string): boolean {
    return this.relative(path) !== null;
  }

  /**
   * Determines whether an entry itself is listed, so the menu offers to include it again. An entry
   * inside an excluded folder is not listed: including it means including the folder.
   * @param path The entry's absolute path.
   * @returns Returns true when the entry is listed.
   */
  public isListed(path: string): boolean {
    const relative: string | null = this.relative(path);
    return relative !== null && this.paths().includes(relative);
  }

  /**
   * Determines whether an entry is hidden by convention: its name, or a folder above it inside the
   * workspace, starts with a dot.
   * @param path The entry's absolute path.
   * @returns Returns true when the entry is hidden.
   */
  public isHidden(path: string): boolean {
    const relative: string | null = this.relative(path);
    return relative !== null && isHiddenPath(relative);
  }

  /**
   * Excludes the entries that are not listed yet.
   * @param paths The entries' absolute paths.
   * @returns Returns a promise that resolves once the list is saved.
   */
  public exclude(paths: readonly string[]): Promise<void> {
    const additions: string[] = paths
      .map((path: string): string | null => this.relative(path))
      .filter((relative: string | null): relative is string => relative !== null);
    return this.save([...this.paths(), ...additions]);
  }

  /**
   * Includes the listed entries again.
   * @param paths The entries' absolute paths.
   * @returns Returns a promise that resolves once the list is saved.
   */
  public include(paths: readonly string[]): Promise<void> {
    const removals: Set<string> = new Set<string>(
      paths
        .map((path: string): string | null => this.relative(path))
        .filter((relative: string | null): relative is string => relative !== null),
    );
    return this.save(this.paths().filter((entry: string): boolean => !removals.has(entry)));
  }

  /**
   * Flips whether the explorers show hidden things.
   */
  public toggleShowHidden(): void {
    this.hiddenVisible.toggle();
  }

  /**
   * Saves a new list for this tab's root, without duplicates.
   * @param paths The canonical relative paths.
   * @returns Returns a promise that resolves once the write is issued.
   */
  private async save(paths: readonly string[]): Promise<void> {
    const root: string | null = this.rootPath();
    if (root === null) {
      return;
    }
    const unique: readonly string[] = [...new Set<string>(paths)];
    this.remember(root, unique);
    await this.studio.saveExcludedFilesFor(root, unique);
  }

  /**
   * Records the list for a root.
   * @param root The workspace root.
   * @param paths The canonical relative paths.
   */
  private remember(root: string, paths: readonly string[]): void {
    this.cached.update(
      (current: ReadonlyMap<string, readonly string[]>): ReadonlyMap<string, readonly string[]> =>
        new Map<string, readonly string[]>(current).set(root, paths),
    );
  }

  /**
   * Reduces an absolute path to its canonical path relative to the root.
   * @param path The absolute path.
   * @returns Returns the relative path, or null for the root itself or a path outside it.
   */
  private relative(path: string): string | null {
    const root: string | null = this.rootPath();
    if (root === null) {
      return null;
    }
    const slashedRoot: string = root.replace(/\\/g, '/').replace(/\/+$/, '');
    const slashed: string = path.replace(/\\/g, '/');
    if (!slashed.startsWith(`${slashedRoot}/`)) {
      return null;
    }
    const relative: string = normaliseExcludedFile(slashed.slice(slashedRoot.length + 1));
    return relative === '' ? null : relative;
  }
}
