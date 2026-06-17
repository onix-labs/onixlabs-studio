import { ApplicationRef, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ProjectItems, ProjectModel } from '../../../shared/project-system';
import { DirectoryListing, ProjectApi } from '../../../shared/studio-api';
import { Workspace } from '../workspace/workspace';
import { SolutionModel, SolutionRow } from './solution-model';

/**
 * A fake project bridge whose model and per-project contents the test controls, and which can defer all
 * contents requests so the root's loading state is observable mid-flight.
 */
class FakeProject implements ProjectApi {
  public model: ProjectModel | null = null;
  public readonly itemsByPath: Map<string, ProjectItems> = new Map<string, ProjectItems>();
  public readonly itemRequests: string[] = [];
  public deferItems: boolean = false;
  private resolvers: (() => void)[] = [];

  public loadModel(): Promise<ProjectModel | null> {
    return Promise.resolve(this.model);
  }

  public loadItems(projectPath: string): Promise<ProjectItems | null> {
    this.itemRequests.push(projectPath);
    const value: ProjectItems | null = this.itemsByPath.get(projectPath) ?? null;
    if (this.deferItems) {
      return new Promise<ProjectItems | null>((resolve: (items: ProjectItems | null) => void): void => {
        this.resolvers.push((): void => resolve(value));
      });
    }
    return Promise.resolve(value);
  }

  public resolveAll(): void {
    const resolvers: (() => void)[] = this.resolvers;
    this.resolvers = [];
    for (const resolve of resolvers) {
      resolve();
    }
  }
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
      { type: 'folder', name: 'Group', children: [{ type: 'project', name: 'A', path: '/root/A/A.csproj' }] },
      { type: 'project', name: 'B', path: '/root/B/B.csproj' },
    ],
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
      { type: 'folder', name: 'Sub', children: [{ type: 'file', name: 'f.cs', path: '/root/A/Sub/f.cs' }] },
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

  /**
   * Builds the service under test with the fakes wired in.
   * @returns Returns the service.
   */
  function build(): SolutionModel {
    TestBed.configureTestingModule({
      providers: [SolutionModel, { provide: Workspace, useValue: { root } }],
    });
    return TestBed.inject(SolutionModel);
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
    (window as unknown as { studio: unknown }).studio = { project };
  });

  afterEach(() => {
    delete (window as unknown as { studio?: unknown }).studio;
  });

  it('rootOpens_withModel_nestsTheStructureUnderASolutionRootNamedAfterTheSolution', async () => {
    project.model = sampleModel();
    const model: SolutionModel = build();
    await open(model);

    // The root node is the solution name; the folders and projects nest under it.
    expect(rowFor(model, 'MySolution')?.kind).toBe('solution');
    expect(rowFor(model, 'MySolution')?.depth).toBe(0);
    expect(labels(model)).toEqual(['MySolution', 'Group', 'A', 'B']);
    expect(rowFor(model, 'Group')?.depth).toBe(1);
    expect(rowFor(model, 'A')?.expanded).toBe(false);
  });

  it('rootOpens_withoutSolution_namesTheRootAfterTheFolder', async () => {
    project.model = { kind: 'dotnet', root: '/path/to/MyApp', solution: null, projects: [], tree: [] };
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

  it('open_loadsEveryProjectsContentsUpFront', async () => {
    project.model = sampleModel();
    project.itemsByPath.set('/root/A/A.csproj', sampleItems());
    const model: SolutionModel = build();
    await open(model);

    expect([...project.itemRequests].sort()).toEqual(['/root/A/A.csproj', '/root/B/B.csproj']);
  });

  it('rootNode_whileContentsLoad_isCollapsedNonExpandableWithSpinner_thenExpands', async () => {
    project.model = sampleModel();
    project.deferItems = true;
    const model: SolutionModel = build();
    await open(model);

    // While loading, only the root node shows — collapsed, not expandable, with the spinner.
    expect(labels(model)).toEqual(['MySolution']);
    expect(rowFor(model, 'MySolution')?.loading).toBe(true);
    expect(rowFor(model, 'MySolution')?.expandable).toBe(false);

    project.resolveAll();
    await flush();
    // Once loaded, the spinner clears and the structure is revealed.
    expect(rowFor(model, 'MySolution')?.loading).toBe(false);
    expect(rowFor(model, 'MySolution')?.expandable).toBe(true);
    expect(labels(model)).toEqual(['MySolution', 'Group', 'A', 'B']);
  });

  it('toggle_expandingAProject_showsItsAlreadyLoadedContentsWithoutFetchingAgain', async () => {
    project.model = sampleModel();
    project.itemsByPath.set('/root/A/A.csproj', sampleItems());
    const model: SolutionModel = build();
    await open(model);
    const requestsAfterOpen: number = project.itemRequests.length;

    model.toggle(rowFor(model, 'A')!);

    // A's contents appear with no further fetch; its sub-folder is collapsed so its file is hidden.
    expect(project.itemRequests.length).toBe(requestsAfterOpen);
    expect(labels(model)).toEqual(['MySolution', 'Group', 'A', 'Sub', 'g.cs', 'B']);
  });

  it('toggle_collapsingTheRoot_hidesEverything', async () => {
    project.model = sampleModel();
    const model: SolutionModel = build();
    await open(model);

    model.toggle(rowFor(model, 'MySolution')!);

    expect(labels(model)).toEqual(['MySolution']);
  });
});
