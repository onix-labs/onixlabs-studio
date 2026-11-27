import { RememberedSwitch } from '@shared/angular/services/explorer-filter/remembered-switch';
import { Settings } from '@shared/angular/services/settings/settings';
import { explorerSorted } from '@shared/angular/services/workspace/explorer-sort';
import {
  FileNesting,
  FileNestingRule,
  fileNestingRules,
  nestFiles,
} from '@shared/angular/services/workspace/file-nesting';
import { computed, effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { ExplorerFilter } from '@shared/angular/services/explorer-filter/explorer-filter';
import { Bridge } from '@shared/api/bridge';
import { DirectoryChangeEvent } from '@shared/api/file-channels';
import { ProjectChannel } from '@shared/api/project-channels';
import {
  ProjectCapabilities,
  ProjectEntry,
  ProjectItemNode,
  ProjectItems,
  ProjectModel,
  ProjectNode,
  ProjectOperationResult,
} from '@shared/api/project-system';
import { DirectoryWatch } from '@shared/angular/services/directory-watch/directory-watch';
import { DockTabContext } from '@shared/angular/services/dock-layout/dock-tab-context';
import { Log } from '@shared/angular/services/log/log';
import { Workspace } from '@shared/angular/services/workspace/workspace';

/**
 * The kind of a Solution Explorer row, which decides its icon and click behaviour.
 */
export type SolutionRowKind = 'solution' | 'folder' | 'project' | 'item-folder' | 'file';

/**
 * The key of the synthetic workspace root row that every other row nests under. Its label is the
 * workspace's display name (name plus branch), never a path segment.
 */
const ROOT_KEY: string = 'solution-root';

/**
 * How many projects' contents are evaluated at once by the background sweep. Deliberately 1: each
 * evaluation is a full MSBuild process, and the sweep runs while the language server is loading the
 * same solution — a wider sweep saturated the machine on large solutions. Expanding or revealing a
 * project jumps the queue and fetches immediately, so the trickle costs the user nothing.
 */
const BACKGROUND_LOAD_CONCURRENCY: number = 1;

/**
 * How long, in milliseconds, external on-disk changes are debounced before the model reloads, so a
 * burst (a build, a checkout) reloads once rather than per file.
 */
const RELOAD_DEBOUNCE_MS: number = 300;

/**
 * How long, in milliseconds, search-query keystrokes are debounced before the tree filter runs.
 */
const QUERY_DEBOUNCE_MS: number = 150;

/**
 * Describes a project item that is a folder.
 */
type ProjectItemFolder = Extract<ProjectItemNode, { readonly type: 'folder' }>;

/**
 * Describes a project item that is a file.
 */
type ProjectItemFile = Extract<ProjectItemNode, { readonly type: 'file' }>;

/**
 * A flattened Solution Explorer row: one visible line of the tree, with its depth, expansion, and
 * loading state already resolved so the view renders it directly.
 */
export interface SolutionRow {
  /**
   * Holds the row's stable identity, used to toggle its expansion and as the render key.
   */
  readonly key: string;

  /**
   * Holds the row's depth in the tree.
   */
  readonly depth: number;

  /**
   * Holds the row's display label.
   */
  readonly label: string;

  /**
   * Holds the row's kind.
   */
  readonly kind: SolutionRowKind;

  /**
   * Holds whether the row can be expanded.
   */
  readonly expandable: boolean;

  /**
   * Holds whether the row is currently expanded.
   */
  readonly expanded: boolean;

  /**
   * Holds whether the row shows a loading spinner: a project while its own contents load, and a folder
   * or the solution root while any project beneath it is still loading.
   */
  readonly loading: boolean;

  /**
   * Holds whether the row is still waiting on what it stands for — a project whose contents have not
   * arrived, and a folder or the solution root with any such project beneath it.
   *
   * Wider than {@link loading}, and the difference is the point: projects are fetched one after
   * another, so at any moment only the one in flight is `loading` while the rest sit unfetched. A row
   * that showed its finished state until its own turn came would flicker through the tree as each
   * project resolved. `pending` stays true from the first render until the subtree is genuinely
   * complete, so the tree greys out as a whole and comes back as a whole.
   */
  readonly pending: boolean;

  /**
   * Holds the absolute path the row opens (a project or file), or null when it opens nothing.
   */
  readonly path: string | null;

  /**
   * Holds the paths whose source-control state colours the row, in order of precedence (#860).
   *
   * Usually just {@link path}, but the rows that stand for more than one file differ from what they
   * open: a project opens its project file yet stands for its whole directory, the root stands for the
   * workspace root, and a solution folder — no directory of its own — stands for the projects beneath
   * it. Empty when the row stands for nothing on disk.
   */
  readonly scmPaths: readonly string[];

  /**
   * Holds the paths of the files nested beneath a file's row by File Nesting, in the order they show;
   * empty for every other row. A row with any is expandable, and also opens its own file.
   */
  readonly nestedPaths: readonly string[];
}

/**
 * The project a file belongs to, as {@link SolutionModel.owningProject} finds it.
 */
export interface OwningProject {
  /**
   * Gets the project's display name.
   */
  readonly name: string;

  /**
   * Gets the absolute path of the project file.
   */
  readonly path: string;

  /**
   * Gets the absolute path of the directory the project file sits in, which holds its files.
   */
  readonly directory: string;
}

/**
 * Holds and drives this tab's Solution Explorer. When a .NET workspace opens, it fetches the logical
 * project model for the root and shows the full structure — solution folders and projects — straight
 * away, while a low-priority background sweep evaluates project contents one at a time (so search and
 * expand-all eventually cover everything without saturating the machine at open). Expanding or
 * revealing a project jumps the queue and fetches its contents immediately; a project carries a
 * spinner while its fetch is in flight. External change bursts reload only the projects whose
 * directories actually changed. Exposes the model's presence (which the directory view uses to show
 * or hide the panel) and a flattened row list the panel renders. Provided per directory tab. Outside
 * Electron the bridge is absent and the model stays null.
 */
@Service()
export class SolutionModel {
  /**
   * Holds this tab's workspace, whose root the model is built for.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the settings, for Sort Order.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the view's dock context, whose display name titles the workspace root row.
   */
  private readonly context: DockTabContext = inject(DockTabContext);

  /**
   * Holds the directory-watch service the root is subscribed to, so external on-disk changes reload
   * the model.
   */
  private readonly directoryWatch: DirectoryWatch = inject(DirectoryWatch);

  /**
   * Holds the structured logger for the solution model.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the pending debounced reload timer, or null when none is scheduled.
   */
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds the pending debounced search-query timer, or null when none is scheduled.
   */
  private queryTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds the changed directories accumulated for the pending debounced reload, or null when the
   * whole tree must be treated as changed (an overflow burst), or undefined when no reload is
   * pending. Drives the targeted reload: only projects whose directories appear here re-evaluate.
   */
  private pendingChangedDirs: Set<string> | null | undefined = undefined;

  /**
   * Holds whether the hosting view is visible. True by default so a consumer that never wires
   * {@link setActive} behaves exactly as before.
   */
  private active: boolean = true;

  /**
   * Holds the root whose watch-driven reload was deferred while the view was hidden, or null when
   * none is owed (see {@link setActive}).
   */
  private deferredRoot: string | null = null;

  /**
   * Holds the background evaluation queue for the current load generation: the paths of the projects
   * whose contents have not been fetched yet, drained one at a time.
   */
  private queue: string[] = [];

  /**
   * Holds the number of fetches currently running from the background queue.
   */
  private activeWorkers: number = 0;

  /**
   * Holds the paths of the projects whose contents fetch is currently in flight (from the queue or a
   * priority request), so the same project is never fetched twice concurrently.
   */
  private readonly inFlight: Set<string> = new Set<string>();

  /**
   * Holds the paths a newer load wanted re-evaluated while an older fetch of them was still in flight.
   * That fetch's answer belongs to the older load and is discarded, so each is queued again as it
   * settles; otherwise a project changed mid-evaluation kept its old contents.
   */
  private readonly refetch: Set<string> = new Set<string>();

  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the current model, or null when no root is open or none was recognised.
   */
  private readonly current: WritableSignal<ProjectModel | null> = signal<ProjectModel | null>(null);

  /**
   * Holds the keys of the currently expanded rows.
   */
  private readonly expandedKeys: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds the loaded contents of each project, keyed by project path. Populated up front as the
   * solution loads.
   */
  private readonly itemsByProject: WritableSignal<ReadonlyMap<string, ProjectItems>> = signal<
    ReadonlyMap<string, ProjectItems>
  >(new Map<string, ProjectItems>());

  /**
   * Holds the paths of the projects whose contents are still loading, so each shows its own spinner
   * until its contents arrive.
   */
  private readonly loadingProjects: WritableSignal<ReadonlySet<string>> = signal<
    ReadonlySet<string>
  >(new Set<string>());

  /**
   * Holds the directories created from the Solution Explorer that hold nothing yet. A project's tree is
   * built from its files, so an empty folder is not in it; a folder the user has just made is shown
   * anyway, until it has a file of its own (when the project lists it) or the solution is loaded again.
   */
  private readonly createdFolders: WritableSignal<ReadonlySet<string>> = signal<
    ReadonlySet<string>
  >(new Set<string>());

  /**
   * Holds the active search query. While non-empty the tree is filtered to the rows whose label
   * contains it (and their ancestors), with the matching branches force-expanded.
   */
  private readonly searchQuery: WritableSignal<string> = signal<string>('');

  /**
   * Holds the key of the selected row, or null when nothing is selected.
   */
  private readonly selectedKeySignal: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds whether a chain of folders holding only one another shows as a single row.
   */
  private readonly collapsingEmptyFolders: RememberedSwitch = new RememberedSwitch(
    'workspace.solution.collapseEmptyFolders',
    false,
  );

  /**
   * Holds whether the tree follows the active document, expanding to and selecting it as the editor
   * changes.
   *
   * On by default, because following is what the tree is usually wanted to do; offered as a switch
   * because it is not always — reading around a solution while a generated file stays open drags the
   * selection back with every tab change.
   */
  private readonly syncWithActive: RememberedSwitch = new RememberedSwitch(
    'workspace.solution.followActiveDocument',
    true,
  );

  /**
   * Holds whether files gather the files File Nesting names beneath them. On by default here: the
   * Solution Explorer is where a type split across several files is looked for.
   */
  private readonly nestingFiles: RememberedSwitch = new RememberedSwitch(
    'workspace.solution.nestFiles',
    true,
  );

  /**
   * Gets the File Nesting rules, read once per change of the setting.
   */
  private readonly nestingRules: Signal<readonly FileNestingRule[]> = computed(
    (): readonly FileNestingRule[] =>
      fileNestingRules(this.settings.value('workspaces.fileNesting')()),
  );

  /**
   * Holds whether rows carry their git change badge.
   */
  private readonly gitStatusShown: RememberedSwitch = new RememberedSwitch(
    'workspace.solution.showGitStatus',
    true,
  );

  /**
   * Holds the generation of the current load, so a stale load (the root changed while it was in flight)
   * does not apply its results.
   */
  private generation: number = 0;

  /**
   * Holds whether the project model has been determined for the current root.
   */
  private readonly settledSignal: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the current project model, or null when there is none.
   */
  public readonly model: Signal<ProjectModel | null> = this.current.asReadonly();

  /**
   * Gets whether the workspace's project model has been determined — a solution, or that there is
   * none — rather than still being loaded (#1182): until then, its language servers have not even
   * been started, and the Error List is still analysing rather than finding nothing.
   */
  public readonly settled: Signal<boolean> = computed((): boolean => this.settledSignal());

  /**
   * Gets the active project's declared capabilities, or null when there is no model. Exposed so the
   * ribbon can gate its optional controls from data; the model itself carries the descriptor.
   */
  public readonly capabilities: Signal<ProjectCapabilities | null> = computed(
    (): ProjectCapabilities | null => this.current()?.capabilities ?? null,
  );

  /**
   * Gets the active search query, exposed so the panel can highlight the matched text.
   */
  public readonly query: Signal<string> = this.searchQuery.asReadonly();

  /**
   * Gets the key of the selected row, or null when nothing is selected.
   */
  public readonly selectedKey: Signal<string | null> = this.selectedKeySignal.asReadonly();

  /**
   * Gets the flattened, visible rows of the solution tree.
   */
  public readonly rows: Signal<readonly SolutionRow[]> = computed((): readonly SolutionRow[] => {
    const model: ProjectModel | null = this.current();
    if (model === null) {
      return [];
    }
    // While searching, the root is force-expanded so the matches it nests show.
    const query: string = this.searchQuery().trim().toLowerCase();
    const filtering: boolean = query.length > 0;
    const expanded: boolean = filtering || this.expandedKeys().has(ROOT_KEY);
    // The root shows its full structure immediately, and spins while any project anywhere beneath it is
    // still loading (each project and the folders above it carry the same aggregate spinner).
    const loading: boolean = this.loadingProjects().size > 0;
    // Whether anything beneath the root has yet to arrive. Unlike `loading`, this is true from the
    // first render rather than only while a fetch is in flight, so the tree reads as one unfinished
    // thing instead of resolving folder by folder as each project's turn comes round.
    const pending: boolean = this.nodesPending(model.tree);
    // The root row is the WORKSPACE — its display name (name plus branch), never a GUID path
    // segment; the raw folder name is only the pre-announcement fallback. The structure nests
    // directly beneath it: neither the solution file nor a lone root-level project gets a row of
    // its own — each would only repeat the repository's name.
    const rootLabel: string = this.context.displayName() ?? this.folderName(model.root);
    const rows: SolutionRow[] = [
      this.row(ROOT_KEY, 0, rootLabel, 'solution', true, expanded, loading, pending, null, [
        model.root,
      ]),
    ];
    const hoisted: string | null = this.hoistedProjectPath(model);
    if (expanded) {
      if (hoisted !== null) {
        const items: ProjectItems | undefined = this.itemsByProject().get(hoisted);
        if (items !== undefined) {
          if (filtering) {
            this.appendItemsFiltered(
              items.tree,
              1,
              `project:${hoisted}`,
              rows,
              query,
              this.directoryOf(hoisted),
            );
          } else {
            this.appendItems(items.tree, 1, `project:${hoisted}`, rows, this.directoryOf(hoisted));
          }
        }
      } else if (filtering) {
        this.appendNodesFiltered(model.tree, 1, '', rows, query);
      } else {
        this.appendNodes(model.tree, 1, '', rows);
      }
    }
    return rows;
  });

  /**
   * Initializes a new instance of the {@link SolutionModel} class, refreshing the model whenever the
   * open root changes and reloading it (preserving expansion) when the root's contents change on disk
   * outside the application.
   */
  public constructor() {
    effect((onCleanup: (fn: () => void) => void): void => {
      const root: string | null = this.workspace.root()?.path ?? null;
      void this.refresh(root);
      if (root === null) {
        return;
      }
      const dispose: () => void = this.directoryWatch.watch(
        root,
        (event: DirectoryChangeEvent): void => this.onTreeChanged(root, event),
      );
      onCleanup((): void => {
        dispose();
        this.cancelReload();
      });
    });
  }

  /**
   * Gets the directory a new file or folder made from a row goes in: a project's own directory, a
   * folder's, the directory a file lies in — and, for the root row, the directory of the lone project
   * whose contents it shows in place of a project row.
   * @param row The row.
   * @returns Returns the directory, or null when the row stands for none: a solution folder, a folder
   * that is only logical, and a root row holding more than one project.
   */
  public creationDirectory(row: SolutionRow): string | null {
    switch (row.kind) {
      case 'project':
      case 'file':
        return row.path === null ? null : this.directoryOf(row.path);
      case 'item-folder':
        return row.path;
      case 'solution': {
        const model: ProjectModel | null = this.current();
        const hoisted: string | null = model === null ? null : this.hoistedProjectPath(model);
        return hoisted === null ? null : this.directoryOf(hoisted);
      }
      default:
        return null;
    }
  }

  /**
   * Shows a folder just created from the Solution Explorer, which holds nothing for its project to
   * list yet.
   * @param path The folder's absolute path.
   */
  public noteCreatedFolder(path: string): void {
    this.createdFolders.set(new Set<string>([...this.createdFolders(), path]));
  }

  /**
   * Keeps what was created showing after a folder is renamed: the folder itself, when it was created
   * here, and any created beneath it, under their new paths.
   * @param path The folder's absolute path before the rename.
   * @param renamed Its path now, when the rename reported one.
   */
  public renameCreatedFolder(path: string, renamed: string | undefined): void {
    const moved: string[] = [...this.createdFolders()].filter((folder: string): boolean =>
      this.isAtOrBeneath(folder, path),
    );
    if (moved.length === 0) {
      return;
    }
    this.forgetCreatedFolder(path);
    if (renamed !== undefined) {
      this.createdFolders.set(
        new Set<string>([
          ...this.createdFolders(),
          ...moved.map((folder: string): string => `${renamed}${folder.slice(path.length)}`),
        ]),
      );
    }
  }

  /**
   * Stops showing the created folders that are no longer on disk — deleted or renamed outside the
   * Solution Explorer, which would otherwise leave a row standing for nothing.
   * @param changed The directories that changed, to check only what lies in them; null to check all.
   * @returns Returns a promise that resolves once each has been checked.
   */
  public async pruneCreatedFolders(changed: ReadonlySet<string> | null): Promise<void> {
    const normalized: ReadonlySet<string> | null =
      changed === null
        ? null
        : new Set<string>([...changed].map((path: string): string => path.replaceAll('\\', '/')));
    const candidates: string[] = [...this.createdFolders()].filter(
      (folder: string): boolean =>
        normalized === null ||
        normalized.has(folder.replaceAll('\\', '/')) ||
        normalized.has(this.directoryOf(folder).replaceAll('\\', '/')),
    );
    await Promise.all(
      candidates.map(async (folder: string): Promise<void> => {
        if ((await this.workspace.readDirectoryListing(folder)) === null) {
          this.forgetCreatedFolder(folder);
        }
      }),
    );
  }

  /**
   * Stops showing a created folder, and any created beneath it, once it is deleted.
   * @param path The folder's absolute path.
   */
  public forgetCreatedFolder(path: string): void {
    const kept: string[] = [...this.createdFolders()].filter(
      (folder: string): boolean => !this.isAtOrBeneath(folder, path),
    );
    if (kept.length !== this.createdFolders().size) {
      this.createdFolders.set(new Set<string>(kept));
    }
  }

  /**
   * Toggles a row's expansion. Expanding a project whose contents have not arrived yet requests them
   * ahead of the background sweep; its children appear (under its spinner) when they do.
   * @param row The row to toggle.
   */
  public toggle(row: SolutionRow): void {
    if (!row.expandable) {
      return;
    }
    const next: Set<string> = new Set<string>(this.expandedKeys());
    if (next.has(row.key)) {
      next.delete(row.key);
    } else {
      next.add(row.key);
      if (row.kind === 'project' && row.path !== null) {
        this.requestItems(row.path);
      }
    }
    this.expandedKeys.set(next);
  }

  /**
   * Opens a row, and leaves it open when it is open already. Unlike {@link toggle}, which reads the
   * row's showing state: while a search is filtering the tree that state says whether the row holds a
   * match, not whether the user opened it, and toggling by it could close a row they had open.
   * @param row The row to open.
   */
  public expand(row: SolutionRow): void {
    if (!row.expandable || this.expandedKeys().has(row.key)) {
      return;
    }
    this.expandedKeys.set(new Set<string>([...this.expandedKeys(), row.key]));
    if (row.kind === 'project' && row.path !== null) {
      this.requestItems(row.path);
    }
  }

  /**
   * Sets the search query that filters the tree, or clears it when empty. Debounced: filtering
   * force-expands every matching branch and rebuilds the whole row list, so it must not run per
   * keystroke of a fast typist on a large solution.
   * @param value The query text.
   */
  public setQuery(value: string): void {
    if (this.queryTimer !== null) {
      clearTimeout(this.queryTimer);
    }
    this.queryTimer = setTimeout((): void => {
      this.queryTimer = null;
      this.searchQuery.set(value);
    }, QUERY_DEBOUNCE_MS);
  }

  /**
   * Selects a row by key.
   * @param key The key of the row to select.
   */
  public select(key: string): void {
    this.selectedKeySignal.set(key);
  }

  /**
   * Clears the selection, so no row is selected — what a click on the tree's empty space asks for.
   */
  public clearSelection(): void {
    this.selectedKeySignal.set(null);
  }

  /**
   * Reveals a file in the tree: expands the chain of rows leading to it (the root, its solution
   * folders, its project, and its item folders) and selects its row. Used to keep the Solution
   * Explorer's selection following the active document. Does nothing when the file is not part of a
   * loaded project (its contents may still be loading, or the file lies outside the solution).
   * @param path The absolute path of the file to reveal.
   * @returns Returns true when the file was found and revealed.
   */
  public revealPath(path: string): boolean {
    const model: ProjectModel | null = this.current();
    if (model === null) {
      return false;
    }
    const chain: readonly string[] | null = this.keysToFile(model, path);
    if (chain === null) {
      // The file may belong to a project whose contents have not arrived yet: request them ahead of
      // the background sweep so a later reveal (the next activation, the next document switch) lands.
      this.warmOwningProject(path);
      return false;
    }
    this.expandedKeys.update((current: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set<string>(current);
      for (const key of chain) {
        next.add(key);
      }
      return next;
    });
    this.log.trace('workspace.solution', 'Reveal path in solution tree', path);
    this.selectedKeySignal.set(`file:${path}`);
    return true;
  }

  /**
   * Finds the chain of expandable keys leading to a file: the solution root, the solution folders
   * above its project, the project itself, and the item folders above the file.
   * @param model The model to walk.
   * @param path The absolute file path to find.
   * @returns Returns the ancestor keys, or null when the file is not in a loaded project.
   */
  private keysToFile(model: ProjectModel, path: string): readonly string[] | null {
    const walkItems: (
      nodes: readonly ProjectItemNode[],
      parentKey: string,
      ancestors: readonly string[],
    ) => readonly string[] | null = (
      nodes: readonly ProjectItemNode[],
      parentKey: string,
      ancestors: readonly string[],
    ): readonly string[] | null => {
      const nesting: FileNesting<ProjectItemFile> = this.nesting(nodes);
      for (const node of nodes) {
        if (node.type === 'folder') {
          const key: string = `${parentKey}/${node.name}`;
          const found: readonly string[] | null = walkItems(node.children, key, [
            ...ancestors,
            key,
          ]);
          if (found !== null) {
            return found;
          }
        } else if (node.path === path) {
          return ancestors;
        } else if (
          (nesting.children.get(node) ?? []).some(
            (child: ProjectItemFile): boolean => child.path === path,
          )
        ) {
          // A file nested beneath another is revealed by opening its parent's row.
          return [...ancestors, `file:${node.path}`];
        }
      }
      return null;
    };
    const walkNodes: (
      nodes: readonly ProjectNode[],
      parentKey: string,
      ancestors: readonly string[],
    ) => readonly string[] | null = (
      nodes: readonly ProjectNode[],
      parentKey: string,
      ancestors: readonly string[],
    ): readonly string[] | null => {
      for (const node of nodes) {
        if (node.type === 'folder') {
          const key: string = `${parentKey}/${node.name}`;
          const found: readonly string[] | null = walkNodes(node.children, key, [
            ...ancestors,
            key,
          ]);
          if (found !== null) {
            return found;
          }
        } else {
          const key: string = `project:${node.path}`;
          const items: ProjectItems | undefined = this.itemsByProject().get(node.path);
          if (items !== undefined) {
            const found: readonly string[] | null = walkItems(items.tree, key, [...ancestors, key]);
            if (found !== null) {
              return found;
            }
          }
        }
      }
      return null;
    };
    return walkNodes(model.tree, '', [ROOT_KEY]);
  }

  /**
   * Finds the project a file lies within: the one whose directory is the file's deepest prefix, so a
   * project nested inside another's directory owns its own files (#1007, the Search panel's Current
   * Project scope).
   * @param path The absolute file path.
   * @returns Returns the owning project, or null when there is no model or no project holds the file.
   */
  public owningProject(path: string): OwningProject | null {
    const model: ProjectModel | null = this.current();
    if (model === null) {
      return null;
    }
    const normalized: string = path.replaceAll('\\', '/');
    let owner: OwningProject | null = null;
    let ownerDirectory: string = '';
    for (const project of model.projects) {
      const directory: string = project.path.replaceAll('\\', '/').replace(/\/[^/]*$/, '');
      if (normalized.startsWith(`${directory}/`) && directory.length > ownerDirectory.length) {
        // Keep the project's own separators for the directory: it is handed back to the platform.
        owner = {
          name: project.name,
          path: project.path,
          directory: project.path.replace(/[\\/][^\\/]*$/, ''),
        };
        ownerDirectory = directory;
      }
    }
    return owner;
  }

  /**
   * Requests the contents of the project a file lies within (by deepest directory prefix) when they
   * are not loaded yet, so features that need the file's tree position can find it shortly.
   * @param path The absolute file path.
   */
  private warmOwningProject(path: string): void {
    const owner: OwningProject | null = this.owningProject(path);
    if (owner !== null) {
      this.requestItems(owner.path);
    }
  }

  /**
   * Gets whether the tree follows the active document.
   */
  public readonly followsActiveDocument: Signal<boolean> = this.syncWithActive.on;

  /**
   * Gets whether rows carry their git change badge.
   */
  public readonly showsGitStatus: Signal<boolean> = this.gitStatusShown.on;

  /**
   * Gets whether a chain of folders holding only one another shows as a single row.
   */
  public readonly collapsesEmptyFolders: Signal<boolean> = this.collapsingEmptyFolders.on;

  /**
   * Toggles whether a chain of folders holding only one another shows as a single row.
   */
  public toggleCollapseEmptyFolders(): void {
    this.collapsingEmptyFolders.toggle();
  }

  /**
   * Gets whether files gather the files File Nesting names beneath them.
   */
  public readonly nestsFiles: Signal<boolean> = this.nestingFiles.on;

  /**
   * Toggles whether files gather the files File Nesting names beneath them.
   */
  public toggleNestFiles(): void {
    this.nestingFiles.toggle();
  }

  /**
   * Toggles whether the tree follows the active document.
   */
  public toggleFollowActiveDocument(): void {
    this.syncWithActive.toggle();
  }

  /**
   * Toggles whether rows carry their git change badge.
   */
  public toggleGitStatus(): void {
    this.gitStatusShown.toggle();
  }

  /**
   * Holds what the tree is narrowed to (#1182 follow-up): files version control sees as changed, or
   * with problems of the severities ticked — remembered across restarts, and carrying over the older
   * Show Changed Files Only switch (#1053).
   */
  public readonly filter: ExplorerFilter = new ExplorerFilter(
    'workspace.solution.filters',
    'workspace.solution.changesOnly',
  );

  /**
   * Rebuilds the solution from disk, preserving expansion. Used when a project file has been edited
   * outside anything the watcher attributes to the tree.
   */
  public refreshFromDisk(): void {
    void this.refresh(this.workspace.root()?.path ?? null);
  }

  /**
   * Expands every node in the tree, so the whole structure is revealed.
   */
  public expandAll(): void {
    const model: ProjectModel | null = this.current();
    if (model !== null) {
      this.expandedKeys.set(this.allExpandableKeys(model));
    }
  }

  /**
   * Collapses every node in the tree, leaving only the solution root expanded so its top-level items
   * stay visible.
   */
  public collapseAll(): void {
    this.expandedKeys.set(new Set<string>([ROOT_KEY]));
  }

  /**
   * Renames a solution folder, then rebuilds the model from the rewritten solution file.
   *
   * Expansion is carried across by hand: a solution folder's row key is its logical path, so renaming
   * one invalidates its own key and every descendant folder's. Without the remap the branch the user
   * just renamed would collapse under them — the one place they were certainly looking.
   * @param row The solution-folder row to rename.
   * @param name The folder's new display name.
   * @returns Returns the outcome of the rename.
   */
  public async renameSolutionFolder(
    row: SolutionRow,
    name: string,
  ): Promise<ProjectOperationResult> {
    const root: string | null = this.workspace.root()?.path ?? null;
    if (row.kind !== 'folder' || root === null || this.bridge === undefined) {
      return { success: false, error: 'That folder cannot be renamed.' };
    }
    const result: ProjectOperationResult = (await this.bridge.invoke<ProjectOperationResult>(
      ProjectChannel.SolutionFolderRename,
      root,
      row.key,
      name,
    )) ?? { success: false, error: 'The rename could not be completed.' };
    if (!result.success) {
      return result;
    }
    const renamed: string = `${row.key.slice(0, row.key.lastIndexOf('/'))}/${name.trim()}`;
    this.expandedKeys.update((current: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set<string>();
      for (const key of current) {
        next.add(
          key === row.key || key.startsWith(`${row.key}/`)
            ? `${renamed}${key.slice(row.key.length)}`
            : key,
        );
      }
      return next;
    });
    // reload, not refresh: refresh resets expansion to the root, which would undo the remap above and
    // collapse the whole tree over a one-word edit.
    await this.reload(root, null);
    return result;
  }

  /**
   * Loads the model for a root, clearing it (and all tree state) when there is no root or bridge, then
   * eagerly loading every project's contents. A stale response (the root changed again while the
   * request was in flight) is discarded.
   * @param root The workspace root, or null when none is open.
   * @returns Returns a promise that resolves once the model has been updated.
   */
  private async refresh(root: string | null): Promise<void> {
    const generation: number = ++this.generation;
    if (this.bridge === undefined || root === null) {
      this.reset(null);
      this.settledSignal.set(true);
      return;
    }
    this.settledSignal.set(false);
    const model: ProjectModel | null = await this.bridge.invoke<ProjectModel | null>(
      ProjectChannel.ModelLoad,
      root,
    );
    if (generation !== this.generation) {
      return;
    }
    this.reset(model);
    this.settledSignal.set(true);
    if (model !== null) {
      this.log.info(
        'workspace.solution',
        `Loaded solution model with ${model.projects.length} project(s)`,
        root,
      );
      this.scheduleContents(
        model.projects.map((project: ProjectEntry): string => project.path),
        generation,
      );
    }
  }

  /**
   * Handles a burst of external on-disk changes under the root, accumulating the changed directories
   * and scheduling a debounced, targeted reload. Bursts confined to the repository's `.git` directory
   * or the workspace's `.studio` folder are ignored: they change no project structure, and every git
   * operation or settings write would otherwise re-evaluate the solution. An overflow burst reloads
   * everything — the watcher drops build-output and dependency churn before it can overflow, so an
   * overflow means a genuinely tree-wide change (a large checkout) that may well have changed project
   * structure.
   * @param root The workspace root the changes occurred under.
   * @param event The change burst.
   */
  private onTreeChanged(root: string, event: DirectoryChangeEvent): void {
    const relevant: string[] = event.directories.filter(
      (directory: string): boolean => !this.isReloadExempt(root, directory),
    );
    if (!event.overflow && relevant.length === 0) {
      return;
    }
    if (event.overflow) {
      this.pendingChangedDirs = null;
    } else if (this.pendingChangedDirs !== null) {
      this.pendingChangedDirs ??= new Set<string>();
      for (const directory of relevant) {
        this.pendingChangedDirs.add(directory);
      }
    }
    // A hidden view's reload can spawn a full project-system evaluation (60s budget for MSBuild)
    // for a tree nobody can see; the accumulated changes are kept and the reload runs once on
    // reactivation instead — mirroring the visibility gate the LSP prestart beside it already has.
    if (!this.active) {
      this.deferredRoot = root;
      return;
    }
    this.armReload(root);
  }

  /**
   * Sets whether the hosting view is visible. While hidden, watch-driven reloads defer (their
   * changed directories keep accumulating); reactivation runs the owed reload through the ordinary
   * debounced path.
   * @param active Whether the hosting view is visible.
   */
  public setActive(active: boolean): void {
    this.active = active;
    if (active && this.deferredRoot !== null) {
      const root: string = this.deferredRoot;
      this.deferredRoot = null;
      this.armReload(root);
    }
  }

  /**
   * Arms (or re-arms) the debounced reload with whatever changes have accumulated.
   * @param root The root to reload.
   */
  private armReload(root: string): void {
    if (this.reloadTimer !== null) {
      clearTimeout(this.reloadTimer);
    }
    this.reloadTimer = setTimeout((): void => {
      this.reloadTimer = null;
      const changed: ReadonlySet<string> | null = this.pendingChangedDirs ?? null;
      this.pendingChangedDirs = undefined;
      void this.reload(root, changed);
    }, RELOAD_DEBOUNCE_MS);
  }

  /**
   * Cancels any pending debounced reload and discards its accumulated changes.
   */
  private cancelReload(): void {
    if (this.reloadTimer !== null) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    this.pendingChangedDirs = undefined;
    this.deferredRoot = null;
    if (this.queryTimer !== null) {
      clearTimeout(this.queryTimer);
      this.queryTimer = null;
    }
  }

  /**
   * Determines whether a directory's changes are exempt from triggering a solution reload: the
   * repository's `.git` directory and the workspace's `.studio` folder hold no project structure.
   * @param root The workspace root.
   * @param directory The absolute directory path to test.
   * @returns Returns true when the directory is an exempt folder or inside one.
   */
  private isReloadExempt(root: string, directory: string): boolean {
    const normalizedRoot: string = root.replaceAll('\\', '/');
    const normalized: string = directory.replaceAll('\\', '/');
    return ['.git', '.studio'].some((exempt: string): boolean => {
      const exemptDirectory: string = `${normalizedRoot}/${exempt}`;
      return normalized === exemptDirectory || normalized.startsWith(`${exemptDirectory}/`);
    });
  }

  /**
   * Reloads the model for the current root after its contents changed on disk, preserving the
   * expansion state (unlike {@link refresh}, which resets it for a newly-opened root). Projects whose
   * contents were already loaded keep showing them until their fresh contents arrive, so the tree does
   * not flash back to spinners on every external change — and only the projects whose directories
   * actually changed re-evaluate; the rest keep their cached contents untouched. A stale response is
   * discarded.
   * @param root The workspace root to reload.
   * @param changed The changed directories driving the reload, or null to treat everything as changed.
   * @returns Returns a promise that resolves once the model has been reloaded.
   */
  private async reload(root: string, changed: ReadonlySet<string> | null): Promise<void> {
    const generation: number = ++this.generation;
    if (this.bridge === undefined) {
      return;
    }
    const model: ProjectModel | null = await this.bridge.invoke<ProjectModel | null>(
      ProjectChannel.ModelLoad,
      root,
    );
    if (generation !== this.generation) {
      return;
    }
    this.current.set(model);
    if (model === null) {
      this.itemsByProject.set(new Map<string, ProjectItems>());
      this.loadingProjects.set(new Set<string>());
      this.createdFolders.set(new Set<string>());
      this.refetch.clear();
      this.expandedKeys.set(new Set<string>());
      return;
    }
    if (this.createdFolders().size > 0) {
      void this.pruneCreatedFolders(changed);
    }
    // A project renamed or removed mid-evaluation is no row of the new model: its spinner goes now,
    // rather than keeping the root spinning until its evaluation gives up.
    const present: ReadonlySet<string> = new Set<string>(
      model.projects.map((project: ProjectEntry): string => project.path),
    );
    const loading: ReadonlySet<string> = this.loadingProjects();
    if ([...loading].some((path: string): boolean => !present.has(path))) {
      this.loadingProjects.set(
        new Set<string>([...loading].filter((path: string): boolean => present.has(path))),
      );
    }
    // Drop cached contents of projects that left the model, keep the rest visible while any fresh
    // contents arrive, and re-evaluate only what the burst could have affected: a project is skipped
    // when its contents are cached and none of the changed directories lie inside it.
    const cache: ReadonlyMap<string, ProjectItems> = this.itemsByProject();
    const kept: Map<string, ProjectItems> = new Map<string, ProjectItems>();
    const stale: string[] = [];
    for (const project of model.projects) {
      const items: ProjectItems | undefined = cache.get(project.path);
      if (items !== undefined) {
        kept.set(project.path, items);
      }
      if (items === undefined || changed === null || this.projectTouched(project.path, changed)) {
        stale.push(project.path);
      }
    }
    if (kept.size !== cache.size) {
      this.itemsByProject.set(kept);
    }
    this.log.trace(
      'workspace.solution',
      `Reloaded solution, ${stale.length} project(s) re-evaluating`,
    );
    this.scheduleContents(stale, generation);
  }

  /**
   * Determines whether any changed directory lies within a project's directory, so the project's
   * items (which live beneath it, links aside) may have changed.
   * @param projectPath The absolute project-file path.
   * @param changed The changed directories.
   * @returns Returns true when the project is touched by the burst.
   */
  private projectTouched(projectPath: string, changed: ReadonlySet<string>): boolean {
    const directory: string = projectPath.replaceAll('\\', '/').replace(/\/[^/]*$/, '');
    for (const candidate of changed) {
      const normalized: string = candidate.replaceAll('\\', '/');
      if (normalized === directory || normalized.startsWith(`${directory}/`)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Replaces the model and resets the tree state, collapsing everything but the solution root. A
   * project carries a spinner only while its contents fetch is actually in flight, not while it waits
   * in the background queue.
   * @param model The new model, or null to clear.
   */
  private reset(model: ProjectModel | null): void {
    this.current.set(model);
    this.itemsByProject.set(new Map<string, ProjectItems>());
    this.searchQuery.set('');
    this.selectedKeySignal.set(null);
    this.loadingProjects.set(new Set<string>());
    this.createdFolders.set(new Set<string>());
    this.refetch.clear();
    this.expandedKeys.set(model !== null ? new Set<string>([ROOT_KEY]) : new Set<string>());
  }

  /**
   * Replaces the background evaluation queue with the given project paths and starts draining it, a
   * bounded number of fetches at a time. The queue belongs to the given load generation; a newer
   * refresh or reload replaces it wholesale.
   * @param paths The paths of the projects whose contents need (re-)evaluating.
   * @param generation The load generation this work belongs to.
   */
  private scheduleContents(paths: readonly string[], generation: number): void {
    this.queue = [];
    for (const path of paths) {
      if (this.inFlight.has(path)) {
        this.refetch.add(path);
      } else {
        this.queue.push(path);
      }
    }
    // One combined evaluation for the whole queue (#1600): the loads below are then answered from it
    // rather than each starting the build tool, which is what made opening a solution slow.
    if (this.queue.length > 1) {
      void this.bridge
        ?.invoke<void>(ProjectChannel.ItemsPrefetch, [...this.queue])
        .catch((error: unknown): void =>
          this.log.debug('workspace.solution', 'Could not evaluate the projects together', error),
        );
    }
    this.pump(generation);
  }

  /**
   * Drains the background queue up to the concurrency bound, fetching one project's contents per
   * worker and re-pumping as each completes. Stops when the generation is superseded. A worker that
   * settles pumps whatever queue is current: a newer load replaced the queue while it ran, and that
   * load's own pump found every worker busy, so pumping only the worker's own (superseded) generation
   * left the new queue undrained and its projects pending for good.
   * @param generation The load generation the queue belongs to.
   */
  private pump(generation: number): void {
    while (
      this.activeWorkers < BACKGROUND_LOAD_CONCURRENCY &&
      this.queue.length > 0 &&
      generation === this.generation
    ) {
      const next: string = this.queue.shift()!;
      if (this.inFlight.has(next)) {
        this.refetch.add(next);
        continue;
      }
      this.activeWorkers += 1;
      void this.fetchItems(next, generation).finally((): void => {
        this.activeWorkers -= 1;
        this.pump(this.generation);
      });
    }
  }

  /**
   * Requests a project's contents ahead of the background sweep: called when the user expands or
   * reveals a project whose contents have not arrived yet, so their intent is never queued behind the
   * trickle. Already-loaded and already-fetching projects are left alone.
   * @param path The absolute project-file path.
   */
  private requestItems(path: string): void {
    if (this.itemsByProject().has(path) || this.inFlight.has(path)) {
      return;
    }
    this.queue = this.queue.filter((queued: string): boolean => queued !== path);
    void this.fetchItems(path, this.generation);
  }

  /**
   * Fetches one project's contents, marking it loading while the fetch is in flight and applying the
   * result unless the load generation has been superseded. The spinner clears however the fetch ends
   * — with contents, without, superseded by a newer load, or failed — so it never spins forever: a
   * superseded fetch used to return before clearing it, which a burst of solution edits (an agent
   * adding a project, then creating it) left spinning until the whole solution was reloaded.
   * @param path The absolute project-file path.
   * @param generation The load generation this fetch belongs to.
   * @returns Returns a promise that resolves once the fetch has settled.
   */
  private async fetchItems(path: string, generation: number): Promise<void> {
    this.inFlight.add(path);
    this.setLoading(path, true);
    try {
      const items: ProjectItems | null =
        (await this.bridge?.invoke<ProjectItems | null>(ProjectChannel.ItemsLoad, path)) ?? null;
      if (generation === this.generation && items !== null) {
        const cache: Map<string, ProjectItems> = new Map<string, ProjectItems>(
          this.itemsByProject(),
        );
        cache.set(items.projectPath, items);
        this.itemsByProject.set(cache);
      }
    } catch (error: unknown) {
      this.log.warn('workspace.solution', `Could not evaluate ${path}`, error);
    } finally {
      this.inFlight.delete(path);
      this.setLoading(path, false);
      this.requeueIfWanted(path);
    }
  }

  /**
   * Queues a project again when a newer load asked for it while an older fetch of it was in flight,
   * and it is still part of the solution.
   * @param path The absolute project-file path whose fetch has just settled.
   */
  private requeueIfWanted(path: string): void {
    if (!this.refetch.delete(path)) {
      return;
    }
    const inModel: boolean =
      this.current()?.projects.some((project: ProjectEntry): boolean => project.path === path) ===
      true;
    if (inModel && !this.queue.includes(path)) {
      this.queue.push(path);
      this.pump(this.generation);
    }
  }

  /**
   * Sets or clears a project's loading state, showing or removing its spinner.
   * @param path The project path.
   * @param loading Whether the project's contents fetch is in flight.
   */
  private setLoading(path: string, loading: boolean): void {
    const next: Set<string> = new Set<string>(this.loadingProjects());
    if (loading) {
      next.add(path);
    } else {
      next.delete(path);
    }
    this.loadingProjects.set(next);
  }

  /**
   * Resolves the path of the project to hoist: when the model is a SINGLE project living in the
   * workspace root itself, its row would only repeat the workspace's name, so its contents render
   * directly under the root row instead. A single project in a subdirectory, or any multi-project
   * model, keeps its explicit rows.
   * @param model The model.
   * @returns Returns the hoisted project's path, or null when nothing is hoisted.
   */
  private hoistedProjectPath(model: ProjectModel): string | null {
    if (model.tree.length !== 1) {
      return null;
    }
    const only: ProjectNode = model.tree[0];
    if (only.type !== 'project') {
      return null;
    }
    const root: string = model.root.replace(/[/\\]+$/, '');
    const directory: string = only.path.replace(/[/\\][^/\\]*$/, '');
    return directory === root ? only.path : null;
  }

  /**
   * Resolves a root path's folder name.
   * @param root The root path.
   * @returns Returns the trailing path segment.
   */
  private folderName(root: string): string {
    const segments: string[] = root.replace(/[/\\]+$/, '').split(/[/\\]/);
    return segments[segments.length - 1] || root;
  }

  /**
   * Appends the rows for a run of solution nodes (folders and projects), in ascending name order,
   * recursing into the expanded ones.
   * @param nodes The nodes to append.
   * @param depth The nodes' depth.
   * @param parentKey The key prefix of the nodes' parent.
   * @param rows The list the rows are appended to.
   */
  private appendNodes(
    nodes: readonly ProjectNode[],
    depth: number,
    parentKey: string,
    rows: SolutionRow[],
  ): void {
    for (const node of this.ordered(nodes)) {
      if (node.type === 'folder') {
        // The node's own logical path, not a key assembled from display names: it is what addresses the
        // folder in its solution file, so a rename acts on the folder that file declares. It reads the
        // same either way, so expansion state survives the change.
        const key: string = node.logicalPath;
        const expanded: boolean = this.expandedKeys().has(key);
        // The folder spins while any project beneath it is still loading.
        const loading: boolean = this.nodesLoading(node.children);
        const pending: boolean = this.nodesPending(node.children);
        rows.push(
          this.row(
            key,
            depth,
            node.name,
            'folder',
            true,
            expanded,
            loading,
            pending,
            null,
            this.projectDirectories(node.children),
          ),
        );
        if (expanded) {
          this.appendNodes(node.children, depth + 1, key, rows);
        }
      } else {
        const key: string = `project:${node.path}`;
        const expanded: boolean = this.expandedKeys().has(key);
        const loading: boolean = this.loadingProjects().has(node.path);
        const pending: boolean = !this.itemsByProject().has(node.path);
        // A project is always expandable: expanding one whose contents have not arrived requests
        // them ahead of the background sweep, and its children appear when they do.
        rows.push(
          this.row(key, depth, node.name, 'project', true, expanded, loading, pending, node.path, [
            node.path,
            this.directoryOf(node.path),
          ]),
        );
        const items: ProjectItems | undefined = this.itemsByProject().get(node.path);
        if (expanded && items !== undefined) {
          this.appendItems(items.tree, depth + 1, key, rows, this.directoryOf(node.path));
        }
      }
    }
  }

  /**
   * Orders a run of solution nodes for display: solution folders first, then projects, with each group
   * sorted by name, ascending. The comparison is ordinal (by code unit) rather than locale-aware so that
   * the dot separator (which sorts below every letter) keeps a project directly above its more-qualified
   * siblings — for example `Foo.Bar`, then `Foo.Bar.UnitTests`, then `Foo.Bar.UnitTests.Data`.
   * @param nodes The nodes to order.
   * @returns Returns the nodes ordered folders-first, each group sorted by ascending name.
   */
  private ordered(nodes: readonly ProjectNode[]): readonly ProjectNode[] {
    const byName: (a: ProjectNode, b: ProjectNode) => number = (a, b): number =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    const folders: ProjectNode[] = nodes.filter((node: ProjectNode) => node.type === 'folder');
    const projects: ProjectNode[] = nodes.filter((node: ProjectNode) => node.type === 'project');
    return explorerSorted(
      [...folders.sort(byName), ...projects.sort(byName)],
      (node: ProjectNode): boolean => node.type === 'folder',
      byName,
      this.settings.value('workspaces.sortOrder')(),
    );
  }

  /**
   * Orders a project's items by Sort Order.
   * @param nodes The item nodes, as the project lists them.
   * @returns Returns the nodes in display order.
   */
  private orderedItems(nodes: readonly ProjectItemNode[]): readonly ProjectItemNode[] {
    return explorerSorted(
      nodes,
      (node: ProjectItemNode): boolean => node.type === 'folder',
      (a: ProjectItemNode, b: ProjectItemNode): number => a.name.localeCompare(b.name),
      this.settings.value('workspaces.sortOrder')(),
    );
  }

  /**
   * Determines whether any project beneath a run of nodes is still loading, so a folder (and the root)
   * can carry the aggregate spinner until all of its projects have finished.
   * @param nodes The nodes to scan.
   * @returns Returns true when at least one descendant project is still loading.
   */
  private nodesPending(nodes: readonly ProjectNode[]): boolean {
    return nodes.some((node: ProjectNode): boolean =>
      node.type === 'project'
        ? !this.itemsByProject().has(node.path)
        : this.nodesPending(node.children),
    );
  }

  /**
   * Determines whether any project beneath a run of nodes is still loading, so a folder (and the root)
   * can carry the aggregate spinner until all of its projects have finished.
   * @param nodes The nodes to scan.
   * @returns Returns true when at least one descendant project is still loading.
   */
  private nodesLoading(nodes: readonly ProjectNode[]): boolean {
    return nodes.some((node: ProjectNode): boolean =>
      node.type === 'project'
        ? this.loadingProjects().has(node.path)
        : this.nodesLoading(node.children),
    );
  }

  /**
   * Gets a folder's only child when that child is a folder too and Collapse Empty Folders is on.
   * @param folder The folder.
   * @returns Returns the child, or null when the row stops at this folder.
   */
  private loneFolder(folder: ProjectItemFolder): ProjectItemFolder | null {
    const only: ProjectItemNode | undefined =
      this.collapsesEmptyFolders() && folder.children.length === 1 ? folder.children[0] : undefined;
    return only?.type === 'folder' ? only : null;
  }

  /**
   * Appends the rows for a run of project-item nodes (folders and files), recursing into the expanded
   * folders.
   * @param nodes The item nodes to append.
   * @param depth The nodes' depth.
   * @param parentKey The key prefix of the nodes' parent.
   * @param rows The list the rows are appended to.
   * @param directory The directory the nodes lie in, or null when they lie in none.
   */
  private appendItems(
    nodes: readonly ProjectItemNode[],
    depth: number,
    parentKey: string,
    rows: SolutionRow[],
    directory: string | null,
  ): void {
    const ordered: readonly ProjectItemNode[] = this.orderedItems(
      this.withCreatedFolders(nodes, directory),
    );
    const nesting: FileNesting<ProjectItemFile> = this.nesting(ordered);
    for (const node of ordered) {
      if (node.type === 'folder') {
        let last: ProjectItemFolder = node;
        const names: string[] = [node.name];
        let key: string = `${parentKey}/${node.name}`;
        let next: ProjectItemFolder | null = this.loneFolder(last);
        while (next !== null) {
          last = next;
          names.push(last.name);
          key = `${key}/${last.name}`;
          next = this.loneFolder(last);
        }
        const label: string = names.join(
          this.settings.value('workspaces.collapsedFolderSeparator')(),
        );
        const expanded: boolean = this.expandedKeys().has(key);
        rows.push(
          this.row(key, depth, label, 'item-folder', true, expanded, false, false, last.path),
        );
        if (expanded) {
          this.appendItems(last.children, depth + 1, key, rows, last.path);
        }
      } else if (!nesting.nested.has(node)) {
        const nested: readonly ProjectItemFile[] = nesting.children.get(node) ?? [];
        const expanded: boolean = nested.length > 0 && this.expandedKeys().has(`file:${node.path}`);
        rows.push(this.fileRow(node, depth, nested, expanded));
        if (expanded) {
          for (const child of nested) {
            rows.push(this.fileRow(child, depth + 1, [], false));
          }
        }
      }
    }
  }

  /**
   * Adds the folders created in a directory that its project does not list yet, as empty folders.
   * @param nodes The nodes the project lists there.
   * @param directory The directory, or null when the nodes lie in none.
   * @returns Returns the nodes, with the created folders the project has yet to list.
   */
  private withCreatedFolders(
    nodes: readonly ProjectItemNode[],
    directory: string | null,
  ): readonly ProjectItemNode[] {
    if (directory === null || this.createdFolders().size === 0) {
      return nodes;
    }
    const listed: ReadonlySet<string> = new Set<string>(
      nodes
        .filter((node: ProjectItemNode): boolean => node.type === 'folder')
        .map((node: ProjectItemNode): string => node.name),
    );
    const created: ProjectItemFolder[] = [...this.createdFolders()]
      .filter((path: string): boolean => this.directoryOf(path) === directory)
      .map((path: string): ProjectItemFolder => ({
        type: 'folder',
        name: path.slice(directory.length + 1),
        path,
        children: [],
      }))
      .filter((folder: ProjectItemFolder): boolean => !listed.has(folder.name));
    return created.length === 0 ? nodes : [...nodes, ...created];
  }

  /**
   * Builds a file's row: a leaf, or — with files nested beneath it — a row that expands as well as
   * opens.
   * @param file The file.
   * @param depth The row's depth.
   * @param nested The files nested beneath it.
   * @param expanded Whether it is expanded.
   * @returns Returns the row.
   */
  private fileRow(
    file: ProjectItemFile,
    depth: number,
    nested: readonly ProjectItemFile[],
    expanded: boolean,
  ): SolutionRow {
    return {
      ...this.row(
        `file:${file.path}`,
        depth,
        file.name,
        'file',
        nested.length > 0,
        expanded,
        false,
        false,
        file.path,
      ),
      nestedPaths: nested.map((child: ProjectItemFile): string => child.path),
    };
  }

  /**
   * Nests a run of project items' files by File Nesting, when it is on.
   * @param nodes The items, folders and files.
   * @returns Returns how their files nest; nothing nests while File Nesting is off.
   */
  private nesting(nodes: readonly ProjectItemNode[]): FileNesting<ProjectItemFile> {
    const files: readonly ProjectItemFile[] = this.nestsFiles()
      ? nodes.filter((node: ProjectItemNode): node is ProjectItemFile => node.type === 'file')
      : [];
    return nestFiles<ProjectItemFile>(
      files,
      (file: ProjectItemFile): string => file.name,
      this.nestingRules(),
    );
  }

  /**
   * Appends the filtered rows for a run of solution nodes: a node is kept when its own name matches the
   * query or any of its descendants do, and a kept folder or project is force-expanded so its matching
   * descendants show. Ordering matches the unfiltered tree (folders first, each ascending).
   * @param nodes The nodes to append.
   * @param depth The nodes' depth.
   * @param parentKey The key prefix of the nodes' parent.
   * @param rows The list the rows are appended to.
   * @param query The lower-cased search query.
   * @returns Returns true when any row was appended (the run held a match).
   */
  private appendNodesFiltered(
    nodes: readonly ProjectNode[],
    depth: number,
    parentKey: string,
    rows: SolutionRow[],
    query: string,
  ): boolean {
    let matched: boolean = false;
    for (const node of this.ordered(nodes)) {
      if (node.type === 'folder') {
        const key: string = node.logicalPath;
        const childRows: SolutionRow[] = [];
        const childMatched: boolean = this.appendNodesFiltered(
          node.children,
          depth + 1,
          key,
          childRows,
          query,
        );
        if (this.matches(node.name, query) || childMatched) {
          const loading: boolean = this.nodesLoading(node.children);
          const pending: boolean = this.nodesPending(node.children);
          rows.push(
            this.row(
              key,
              depth,
              node.name,
              'folder',
              true,
              childMatched,
              loading,
              pending,
              null,
              this.projectDirectories(node.children),
            ),
          );
          rows.push(...childRows);
          matched = true;
        }
      } else {
        const key: string = `project:${node.path}`;
        const loading: boolean = this.loadingProjects().has(node.path);
        const items: ProjectItems | undefined = this.itemsByProject().get(node.path);
        const pending: boolean = items === undefined;
        const childRows: SolutionRow[] = [];
        const childMatched: boolean =
          items !== undefined &&
          this.appendItemsFiltered(
            items.tree,
            depth + 1,
            key,
            childRows,
            query,
            this.directoryOf(node.path),
          );
        if (this.matches(node.name, query) || childMatched) {
          rows.push(
            this.row(
              key,
              depth,
              node.name,
              'project',
              true,
              childMatched,
              loading,
              pending,
              node.path,
              [node.path, this.directoryOf(node.path)],
            ),
          );
          rows.push(...childRows);
          matched = true;
        }
      }
    }
    return matched;
  }

  /**
   * Appends the filtered rows for a run of project-item nodes: a file is kept when its name matches, and
   * a folder is kept (and force-expanded) when its name matches or any descendant does.
   * @param nodes The item nodes to append.
   * @param depth The nodes' depth.
   * @param parentKey The key prefix of the nodes' parent.
   * @param rows The list the rows are appended to.
   * @param query The lower-cased search query.
   * @param directory The directory the nodes lie in, or null when they lie in none.
   * @returns Returns true when any row was appended (the run held a match).
   */
  private appendItemsFiltered(
    nodes: readonly ProjectItemNode[],
    depth: number,
    parentKey: string,
    rows: SolutionRow[],
    query: string,
    directory: string | null,
  ): boolean {
    let matched: boolean = false;
    const ordered: readonly ProjectItemNode[] = this.orderedItems(
      this.withCreatedFolders(nodes, directory),
    );
    const nesting: FileNesting<ProjectItemFile> = this.nesting(ordered);
    for (const node of ordered) {
      if (node.type === 'folder') {
        const key: string = `${parentKey}/${node.name}`;
        const childRows: SolutionRow[] = [];
        const childMatched: boolean = this.appendItemsFiltered(
          node.children,
          depth + 1,
          key,
          childRows,
          query,
          node.path,
        );
        if (this.matches(node.name, query) || childMatched) {
          rows.push(
            this.row(
              key,
              depth,
              node.name,
              'item-folder',
              true,
              childMatched,
              false,
              false,
              node.path,
            ),
          );
          rows.push(...childRows);
          matched = true;
        }
      } else if (!nesting.nested.has(node)) {
        // A file nested beneath another shows beneath it when it matches, opening its parent's row.
        const nested: readonly ProjectItemFile[] = nesting.children.get(node) ?? [];
        const matching: readonly ProjectItemFile[] = nested.filter(
          (child: ProjectItemFile): boolean => this.matches(child.name, query),
        );
        if (this.matches(node.name, query) || matching.length > 0) {
          rows.push(this.fileRow(node, depth, nested, matching.length > 0));
          for (const child of matching) {
            rows.push(this.fileRow(child, depth + 1, [], false));
          }
          matched = true;
        }
      }
    }
    return matched;
  }

  /**
   * Determines whether a label matches the search query (a case-insensitive substring).
   * @param label The row label.
   * @param query The lower-cased search query.
   * @returns Returns true when the label contains the query.
   */
  private matches(label: string, query: string): boolean {
    return label.toLowerCase().includes(query);
  }

  /**
   * Collects the keys of every expandable row in the tree — the root, every solution folder and project,
   * and every loaded project's item folders — so expanding all reveals the whole structure.
   * @param model The model to walk.
   * @returns Returns the set of every expandable key.
   */
  private allExpandableKeys(model: ProjectModel): Set<string> {
    const keys: Set<string> = new Set<string>([ROOT_KEY]);
    const walkItems: (nodes: readonly ProjectItemNode[], parentKey: string) => void = (
      nodes: readonly ProjectItemNode[],
      parentKey: string,
    ): void => {
      for (const parent of this.nesting(nodes).children.keys()) {
        keys.add(`file:${parent.path}`);
      }
      for (const node of nodes) {
        if (node.type === 'folder') {
          const key: string = `${parentKey}/${node.name}`;
          keys.add(key);
          walkItems(node.children, key);
        }
      }
    };
    const walkNodes: (nodes: readonly ProjectNode[], parentKey: string) => void = (
      nodes: readonly ProjectNode[],
      parentKey: string,
    ): void => {
      for (const node of nodes) {
        if (node.type === 'folder') {
          const key: string = `${parentKey}/${node.name}`;
          keys.add(key);
          walkNodes(node.children, key);
        } else {
          const key: string = `project:${node.path}`;
          keys.add(key);
          const items: ProjectItems | undefined = this.itemsByProject().get(node.path);
          if (items !== undefined) {
            walkItems(items.tree, key);
          }
        }
      }
    };
    walkNodes(model.tree, '');
    return keys;
  }

  /**
   * Builds a row.
   * @param key The row's identity.
   * @param depth The row's depth.
   * @param label The row's label.
   * @param kind The row's kind.
   * @param expandable Whether the row can be expanded.
   * @param expanded Whether the row is expanded.
   * @param loading Whether the row shows a spinner.
   * @param path The path the row opens, or null.
   * @param scmPaths The paths whose source-control state colours the row; the opened path by default.
   * @returns Returns the row.
   */
  private row(
    key: string,
    depth: number,
    label: string,
    kind: SolutionRowKind,
    expandable: boolean,
    expanded: boolean,
    loading: boolean,
    pending: boolean,
    path: string | null,
    scmPaths: readonly string[] = path !== null ? [path] : [],
  ): SolutionRow {
    return {
      key,
      depth,
      label,
      kind,
      expandable,
      expanded,
      loading,
      pending,
      path,
      scmPaths,
      nestedPaths: [],
    };
  }

  /**
   * Gets the directories of every project beneath a run of solution nodes — what a solution folder,
   * which has no directory of its own, stands for on disk.
   * @param nodes The nodes to scan.
   * @returns Returns the project directories, in tree order.
   */
  private projectDirectories(nodes: readonly ProjectNode[]): readonly string[] {
    return nodes.flatMap((node: ProjectNode): readonly string[] =>
      node.type === 'project'
        ? [this.directoryOf(node.path)]
        : this.projectDirectories(node.children),
    );
  }

  /**
   * Determines whether a path is a folder, or lies beneath it.
   * @param path The path.
   * @param folder The folder.
   * @returns Returns true when it is.
   */
  private isAtOrBeneath(path: string, folder: string): boolean {
    return path === folder || path.startsWith(`${folder}/`) || path.startsWith(`${folder}\\`);
  }

  /**
   * Gets the directory a file lies in.
   * @param path The absolute file path, in either slash form.
   * @returns Returns the directory, or the path unchanged when it has no separator.
   */
  private directoryOf(path: string): string {
    const slash: number = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return slash > 0 ? path.slice(0, slash) : path;
  }
}
