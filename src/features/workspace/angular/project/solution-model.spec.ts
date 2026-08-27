import { ApplicationRef, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { DirectoryChangeEvent } from '@shared/api/file-channels';
import { ProjectChannel } from '@shared/api/project-channels';
import { DirectoryListing } from '@shared/api/workspace-channels';
import { ProjectCapabilities, ProjectItems, ProjectModel } from '@shared/api/project-system';
import { DirectoryWatch } from '@shared/angular/services/directory-watch/directory-watch';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { SolutionModel, SolutionRow } from './solution-model';

/**
 * A fake transport whose project model and per-project contents the test controls, and which can defer
 * all contents requests so the root's loading state is observable mid-flight. Routes the project
 * channels; other channels resolve to null.
 */
class FakeProject implements Bridge {
  public model: ProjectModel | null = null;
  public readonly itemsByPath: Map<string, ProjectItems> = new Map<string, ProjectItems>();
  public readonly itemRequests: string[] = [];
  public modelLoads: number = 0;
  public deferItems: boolean = false;
  private resolvers: (() => void)[] = [];

  public invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    if (channel === (ProjectChannel.ModelLoad as string)) {
      this.modelLoads += 1;
      return Promise.resolve(this.model as T);
    }
    if (channel === (ProjectChannel.ItemsLoad as string)) {
      return this.loadItems(args[0] as string) as Promise<T>;
    }
    return Promise.resolve(null as T);
  }

  public send(): void {
    return undefined;
  }

  public on(): () => void {
    return (): void => undefined;
  }

  public resolveAll(): void {
    const resolvers: (() => void)[] = this.resolvers;
    this.resolvers = [];
    for (const resolve of resolvers) {
      resolve();
    }
  }

  private loadItems(projectPath: string): Promise<ProjectItems | null> {
    this.itemRequests.push(projectPath);
    const value: ProjectItems | null = this.itemsByPath.get(projectPath) ?? null;
    if (this.deferItems) {
      return new Promise<ProjectItems | null>(
        (resolve: (items: ProjectItems | null) => void): void => {
          this.resolvers.push((): void => resolve(value));
        },
      );
    }
    return Promise.resolve(value);
  }
}

/**
 * A representative capability descriptor (the .NET shape) the fake transport stamps onto its model.
 * @returns Returns the capabilities.
 */
function sampleCapabilities(): ProjectCapabilities {
  return {
    actions: ['build', 'clean', 'rebuild'],
    buildConfigurations: [
      { id: 'debug', name: 'Debug' },
      { id: 'release', name: 'Release' },
    ],
    target: { kind: 'platform', label: 'Platform', options: [{ id: 'any-cpu', name: 'Any CPU' }] },
    debug: null,
  };
}

/**
 * A model with a solution folder holding project A and a top-level project B.
 * @returns Returns the model.
 */
function sampleModel(): ProjectModel {
  return {
    kind: 'dotnet',
    root: '/root',
    solution: { name: 'MySolution', path: '/root/MySolution.slnx' },
    projects: [
      { name: 'A', path: '/root/A/A.csproj' },
      { name: 'B', path: '/root/B/B.csproj' },
    ],
    tree: [
      {
        type: 'folder',
        name: 'Group',
        children: [{ type: 'project', name: 'A', path: '/root/A/A.csproj' }],
      },
      { type: 'project', name: 'B', path: '/root/B/B.csproj' },
    ],
    capabilities: sampleCapabilities(),
  };
}

/**
 * Project A's contents: a sub-folder with a file, and a root file.
 * @returns Returns the contents.
 */
function sampleItems(): ProjectItems {
  return {
    projectPath: '/root/A/A.csproj',
    tree: [
      {
        type: 'folder',
        name: 'Sub',
        path: '/root/A/Sub',
        children: [{ type: 'file', name: 'f.cs', path: '/root/A/Sub/f.cs' }],
      },
      { type: 'file', name: 'g.cs', path: '/root/A/g.cs' },
    ],
  };
}

/**
 * Resolves pending microtasks so the service's async fetches settle.
 * @returns Returns a promise that resolves on the next macrotask.
 */
function flush(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

describe('SolutionModel', () => {
  let project: FakeProject;
  let root: WritableSignal<DirectoryListing | null>;
  let treeChanged: ((event: DirectoryChangeEvent) => void) | null;

  /**
   * Builds the service under test with the fakes wired in, capturing the tree-change callback the
   * service registers with the directory watch.
   * @returns Returns the service.
   */
  function build(): SolutionModel {
    TestBed.configureTestingModule({
      providers: [
        SolutionModel,
        { provide: Workspace, useValue: { root } },
        {
          provide: DirectoryWatch,
          useValue: {
            watch: (
              _root: string,
              onChange: (event: DirectoryChangeEvent) => void,
            ): (() => void) => {
              treeChanged = onChange;
              return (): void => undefined;
            },
          },
        },
      ],
    });
    return TestBed.inject(SolutionModel);
  }

  /**
   * Waits long enough for the service's reload debounce to have fired.
   * @returns Returns a promise that resolves once the debounce window has passed.
   */
  function waitForReloadDebounce(): Promise<void> {
    return new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 350);
    });
  }

  /**
   * Drives the open-root effect and lets the async model/contents fetches settle.
   * @returns Returns a promise that resolves once the service has settled.
   */
  async function settle(): Promise<void> {
    TestBed.inject(ApplicationRef).tick();
    await flush();
  }

  /**
   * Finds the row with the given label.
   * @param model The service under test.
   * @param label The label to find.
   * @returns Returns the row, or undefined.
   */
  function rowFor(model: SolutionModel, label: string): SolutionRow | undefined {
    return model.rows().find((row: SolutionRow): boolean => row.label === label);
  }

  /**
   * Lists the labels of the visible rows.
   * @param model The service under test.
   * @returns Returns the labels in order.
   */
  function labels(model: SolutionModel): string[] {
    return model.rows().map((row: SolutionRow): string => row.label);
  }

  /**
   * Opens the root and settles.
   * @param model The service under test.
   * @returns Returns a promise that resolves once opened.
   */
  async function open(model: SolutionModel): Promise<void> {
    root.set({ path: '/root', name: 'root', entries: [] });
    await settle();
    void model;
  }

  beforeEach(() => {
    project = new FakeProject();
    root = signal<DirectoryListing | null>(null);
    treeChanged = null;
    (window as unknown as { bridge: Bridge }).bridge = project;
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  it('rootOpens_withModel_nestsTheStructureUnderASolutionRootNamedAfterTheSolution', async () => {
    project.model = sampleModel();
    const model: SolutionModel = build();
    await open(model);

    // The root node is the WORKSPACE (its display name, falling back to the folder); the structure
    // nests directly beneath it — the solution file gets no row of its own. The folder's contents
    // stay hidden until it is opened.
    expect(rowFor(model, 'root')?.kind).toBe('solution');
    expect(rowFor(model, 'root')?.depth).toBe(0);
    expect(labels(model)).toEqual(['root', 'Group', 'B']);
    expect(rowFor(model, 'Group')?.depth).toBe(1);
    expect(rowFor(model, 'Group')?.expanded).toBe(false);
  });

  it('rows_withASingleProjectInTheWorkspaceRoot_hoistsItsContentsUnderTheRoot', async () => {
    // A lone project living in the workspace root itself (a plain npm package, a single .csproj)
    // would only repeat the workspace's name — its contents render directly under the root row.
    project.model = {
      kind: 'node',
      root: '/root',
      solution: null,
      projects: [{ name: 'root', path: '/root/package.json' }],
      tree: [{ type: 'project', name: 'root', path: '/root/package.json' }],
      capabilities: sampleCapabilities(),
    };
    project.itemsByPath.set('/root/package.json', {
      projectPath: '/root/package.json',
      tree: [{ type: 'file', name: 'index.js', path: '/root/index.js' }],
    });
    const model: SolutionModel = build();
    await open(model);

    expect(labels(model)).toEqual(['root', 'index.js']);
    expect(rowFor(model, 'index.js')?.depth).toBe(1);
  });

  it('rows_withASingleProjectInASubdirectory_keepsItsRow', async () => {
    project.model = {
      kind: 'node',
      root: '/root',
      solution: null,
      projects: [{ name: 'App', path: '/root/app/package.json' }],
      tree: [{ type: 'project', name: 'App', path: '/root/app/package.json' }],
      capabilities: sampleCapabilities(),
    };
    const model: SolutionModel = build();
    await open(model);

    expect(labels(model)).toEqual(['root', 'App']);
  });

  it('rootOpens_withModel_exposesTheCapabilitiesAndRunConfigurationsFromTheLoadedModel', async () => {
    project.model = sampleModel();
    const model: SolutionModel = build();
    await open(model);

    // The capability descriptor rides the model over the ModelLoad channel, so the renderer exposes
    // exactly what the provider stamped on in the main process.
    expect(model.capabilities()?.actions).toEqual(['build', 'clean', 'rebuild']);
    expect(model.capabilities()?.buildConfigurations.map((c) => c.name)).toEqual([
      'Debug',
      'Release',
    ]);
    expect(model.capabilities()?.target?.label).toBe('Platform');
    expect(model.capabilities()?.debug).toBeNull();
  });

  it('rootOpens_withoutModel_hasNoCapabilities', async () => {
    project.model = null;
    const model: SolutionModel = build();
    await open(model);

    expect(model.capabilities()).toBeNull();
  });

  it('rootOpens_withoutSolution_namesTheRootAfterTheFolder', async () => {
    project.model = {
      kind: 'dotnet',
      root: '/path/to/MyApp',
      solution: null,
      projects: [],
      tree: [],
      capabilities: sampleCapabilities(),
    };
    const model: SolutionModel = build();
    root.set({ path: '/path/to/MyApp', name: 'MyApp', entries: [] });
    await settle();

    expect(rowFor(model, 'MyApp')?.kind).toBe('solution');
  });

  it('rootOpens_withoutModel_isEmpty', async () => {
    project.model = null;
    const model: SolutionModel = build();
    await open(model);

    expect(model.model()).toBeNull();
    expect(model.rows()).toEqual([]);
  });

  it('open_sweepsEveryProjectsContentsInTheBackground', async () => {
    project.model = sampleModel();
    project.itemsByPath.set('/root/A/A.csproj', sampleItems());
    const model: SolutionModel = build();
    await open(model);

    expect([...project.itemRequests].sort()).toEqual(['/root/A/A.csproj', '/root/B/B.csproj']);
  });

  it('rootNode_whileContentsLoad_showsSpinnersOnlyForInFlightFetches_thenClears', async () => {
    project.model = sampleModel();
    project.deferItems = true;
    const model: SolutionModel = build();
    await open(model);

    // The background sweep fetches one project at a time: A (first in the model) is in flight, so it
    // and the folder and root above it spin; B merely waits in the queue — no spinner, and it stays
    // expandable so the user can pull it forward.
    expect(labels(model)).toEqual(['root', 'Group', 'B']);
    expect(rowFor(model, 'root')?.loading).toBe(true);
    expect(rowFor(model, 'Group')?.loading).toBe(true);
    expect(rowFor(model, 'B')?.loading).toBe(false);
    expect(rowFor(model, 'B')?.expandable).toBe(true);
    expect(project.itemRequests).toEqual(['/root/A/A.csproj']);

    project.resolveAll();
    await flush();
    // A settled, so the sweep moved on to B.
    expect(project.itemRequests).toEqual(['/root/A/A.csproj', '/root/B/B.csproj']);
    expect(rowFor(model, 'B')?.loading).toBe(true);

    project.resolveAll();
    await flush();
    expect(rowFor(model, 'root')?.loading).toBe(false);
    expect(rowFor(model, 'Group')?.loading).toBe(false);
    expect(rowFor(model, 'B')?.loading).toBe(false);
    expect(labels(model)).toEqual(['root', 'Group', 'B']);
  });

  it('toggle_expandingAQueuedProject_fetchesItAheadOfTheBackgroundSweep', async () => {
    project.model = sampleModel();
    project.deferItems = true;
    project.itemsByPath.set('/root/B/B.csproj', {
      projectPath: '/root/B/B.csproj',
      tree: [{ type: 'file', name: 'b.cs', path: '/root/B/b.cs' }],
    });
    const model: SolutionModel = build();
    await open(model);
    // A's fetch is in flight and B is queued behind it.
    expect(project.itemRequests).toEqual(['/root/A/A.csproj']);

    model.toggle(rowFor(model, 'B')!);
    await flush();

    // B's fetch started immediately, without waiting for A to settle.
    expect(project.itemRequests).toEqual(['/root/A/A.csproj', '/root/B/B.csproj']);
    expect(rowFor(model, 'B')?.loading).toBe(true);

    project.resolveAll();
    await flush();
    expect(rowFor(model, 'B')?.loading).toBe(false);
    expect(labels(model)).toContain('b.cs');
  });

  it('treeChange_reloadsOnlyTheProjectsWhoseDirectoriesChanged', async () => {
    project.model = sampleModel();
    project.itemsByPath.set('/root/A/A.csproj', sampleItems());
    project.itemsByPath.set('/root/B/B.csproj', {
      projectPath: '/root/B/B.csproj',
      tree: [{ type: 'file', name: 'b.cs', path: '/root/B/b.cs' }],
    });
    const model: SolutionModel = build();
    await open(model);
    const loadsAfterOpen: number = project.modelLoads;
    const requestsAfterOpen: number = project.itemRequests.length;

    treeChanged!({ root: '/root', directories: ['/root/A/Sub'], overflow: false });
    await waitForReloadDebounce();

    // The model re-parses, but only A — whose directory the burst touched — re-evaluates; B keeps
    // its cached contents without spawning another evaluation.
    expect(project.modelLoads).toBe(loadsAfterOpen + 1);
    expect(project.itemRequests.slice(requestsAfterOpen)).toEqual(['/root/A/A.csproj']);
    void model;
  });

  it('toggle_expandingAProject_showsItsAlreadyLoadedContentsWithoutFetchingAgain', async () => {
    project.model = sampleModel();
    project.itemsByPath.set('/root/A/A.csproj', sampleItems());
    const model: SolutionModel = build();
    await open(model);
    const requestsAfterOpen: number = project.itemRequests.length;

    // Reveal the folder that holds A, then expand A itself.
    model.toggle(rowFor(model, 'Group')!);
    model.toggle(rowFor(model, 'A')!);

    // A's contents appear with no further fetch; its sub-folder is collapsed so its file is hidden.
    expect(project.itemRequests.length).toBe(requestsAfterOpen);
    expect(labels(model)).toEqual(['root', 'Group', 'A', 'Sub', 'g.cs', 'B']);
  });

  it('rows_aFolderInsideAProject_carriesItsDirectoryWhileASolutionFolderCarriesNone', async () => {
    project.model = sampleModel();
    project.itemsByPath.set('/root/A/A.csproj', sampleItems());
    const model: SolutionModel = build();
    await open(model);
    model.toggle(rowFor(model, 'Group')!);
    model.toggle(rowFor(model, 'A')!);

    // The two folder rows are indistinguishable on screen, and deliberately not in the model: only the
    // one standing for a real directory has a path for the panel's path commands to act on.
    expect(rowFor(model, 'Sub')!.path).toBe('/root/A/Sub');
    expect(rowFor(model, 'Group')!.path).toBeNull();
  });

  it('search_aMatchingFolderInsideAProject_keepsItsDirectory', async () => {
    project.model = sampleModel();
    project.itemsByPath.set('/root/A/A.csproj', sampleItems());
    const model: SolutionModel = build();
    await open(model);
    model.toggle(rowFor(model, 'Group')!);
    model.toggle(rowFor(model, 'A')!);

    model.setQuery('f.cs');
    // setQuery is debounced, so the filtered rows are only rebuilt once the timer has run.
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 200);
    });
    await settle();

    // The filtered tree rebuilds its rows from scratch, so the path has to be carried there too.
    expect(rowFor(model, 'Sub')!.path).toBe('/root/A/Sub');
  });

  it('toggle_collapsingTheRoot_hidesEverything', async () => {
    project.model = sampleModel();
    const model: SolutionModel = build();
    await open(model);

    model.toggle(rowFor(model, 'root')!);

    expect(labels(model)).toEqual(['root']);
  });

  it('revealPath_expandsTheChainToTheFileAndSelectsIt', async () => {
    project.model = sampleModel();
    project.itemsByPath.set('/root/A/A.csproj', sampleItems());
    const model: SolutionModel = build();
    await open(model);

    const revealed: boolean = model.revealPath('/root/A/Sub/f.cs');

    // The solution folder, the project, and the item folder all expanded, so the file is visible.
    expect(revealed).toBe(true);
    expect(labels(model)).toEqual(['root', 'Group', 'A', 'Sub', 'f.cs', 'g.cs', 'B']);
    expect(model.selectedKey()).toBe('file:/root/A/Sub/f.cs');
  });

  it('revealPath_forAFileOutsideTheSolution_returnsFalseAndKeepsState', async () => {
    project.model = sampleModel();
    project.itemsByPath.set('/root/A/A.csproj', sampleItems());
    const model: SolutionModel = build();
    await open(model);

    const revealed: boolean = model.revealPath('/elsewhere/x.cs');

    expect(revealed).toBe(false);
    expect(labels(model)).toEqual(['root', 'Group', 'B']);
    expect(model.selectedKey()).toBeNull();
  });

  it('select_marksTheRowSelected', async () => {
    project.model = sampleModel();
    project.itemsByPath.set('/root/A/A.csproj', sampleItems());
    const model: SolutionModel = build();
    await open(model);

    model.select('file:/root/A/g.cs');

    expect(model.selectedKey()).toBe('file:/root/A/g.cs');
  });

  it('treeChange_touchingSourceDirectories_reloadsTheModel', async () => {
    project.model = sampleModel();
    const model: SolutionModel = build();
    await open(model);
    const loadsAfterOpen: number = project.modelLoads;

    treeChanged!({ root: '/root', directories: ['/root/A'], overflow: false });
    await waitForReloadDebounce();

    expect(project.modelLoads).toBe(loadsAfterOpen + 1);
    void model;
  });

  it('treeChange_confinedToGitAndStudioFolders_doesNotReloadTheModel', async () => {
    project.model = sampleModel();
    const model: SolutionModel = build();
    await open(model);
    const loadsAfterOpen: number = project.modelLoads;

    // Git bookkeeping and settings persistence change no project structure: neither a commit nor a
    // dock-layout write may re-evaluate the solution.
    treeChanged!({
      root: '/root',
      directories: ['/root/.git', '/root/.git/refs/heads', '/root/.studio'],
      overflow: false,
    });
    await waitForReloadDebounce();

    expect(project.modelLoads).toBe(loadsAfterOpen);
    void model;
  });

  it('treeChange_overflowing_reloadsTheModel', async () => {
    project.model = sampleModel();
    const model: SolutionModel = build();
    await open(model);
    const loadsAfterOpen: number = project.modelLoads;

    // An overflow means a genuinely tree-wide change (the watcher drops build churn at the source),
    // so the structure may well have changed.
    treeChanged!({ root: '/root', directories: [], overflow: true });
    await waitForReloadDebounce();

    expect(project.modelLoads).toBe(loadsAfterOpen + 1);
    void model;
  });
});
