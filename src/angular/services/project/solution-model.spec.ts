import { ApplicationRef, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LspProjectLoad } from '../../../shared/lsp-types';
import { ProjectItems, ProjectModel } from '../../../shared/project-system';
import { ProjectApi } from '../../../shared/studio-api';
import { DirectoryListing } from '../../../shared/studio-api';
import { Workspace } from '../workspace/workspace';
import { SolutionModel, SolutionRow } from './solution-model';

/**
 * A fake project bridge whose model and per-project contents the test controls, and which can defer a
 * contents request so the loading state is observable mid-flight.
 */
class FakeProject implements ProjectApi {
  public model: ProjectModel | null = null;
  public readonly itemsByPath: Map<string, ProjectItems> = new Map<string, ProjectItems>();
  public readonly itemRequests: string[] = [];
  public deferItems: boolean = false;
  private pending: ((items: ProjectItems | null) => void) | null = null;

  public loadModel(): Promise<ProjectModel | null> {
    return Promise.resolve(this.model);
  }

  public loadItems(projectPath: string): Promise<ProjectItems | null> {
    this.itemRequests.push(projectPath);
    if (this.deferItems) {
      return new Promise<ProjectItems | null>((resolve: (items: ProjectItems | null) => void): void => {
        this.pending = resolve;
      });
    }
    return Promise.resolve(this.itemsByPath.get(projectPath) ?? null);
  }

  public resolvePending(projectPath: string): void {
    this.pending?.(this.itemsByPath.get(projectPath) ?? null);
    this.pending = null;
  }
}

/**
 * A fake language-server bridge that captures the load-event listener so the test can push events.
 */
class FakeLsp {
  private listener: ((load: LspProjectLoad) => void) | null = null;

  public onProjectLoad(listener: (load: LspProjectLoad) => void): () => void {
    this.listener = listener;
    return (): void => {
      this.listener = null;
    };
  }

  public emit(load: LspProjectLoad): void {
    this.listener?.(load);
  }
}

/**
 * A model with a solution folder holding project A and a top-level project B, used across the tests.
 * @returns Returns the model.
 */
function sampleModel(): ProjectModel {
  return {
    kind: 'dotnet',
    root: '/root',
    solution: { name: 'sln', path: '/root/sln.slnx' },
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
  let lsp: FakeLsp;
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

  beforeEach(() => {
    project = new FakeProject();
    lsp = new FakeLsp();
    root = signal<DirectoryListing | null>(null);
    (window as unknown as { studio: unknown }).studio = { project, lsp };
  });

  afterEach(() => {
    delete (window as unknown as { studio?: unknown }).studio;
  });

  it('rootOpens_withModel_exposesItAndExpandsSolutionFoldersOnly', async () => {
    project.model = sampleModel();
    const model: SolutionModel = build();
    root.set({ path: '/root', name: 'root', entries: [] });
    await settle();

    expect(model.model()).not.toBeNull();
    // Solution folder Group is expanded (its project A shows); projects A and B are collapsed.
    expect(labels(model)).toEqual(['Group', 'A', 'B']);
    expect(rowFor(model, 'Group')?.expanded).toBe(true);
    expect(rowFor(model, 'A')?.expanded).toBe(false);
  });

  it('rootOpens_withoutModel_isEmpty', async () => {
    project.model = null;
    const model: SolutionModel = build();
    root.set({ path: '/root', name: 'root', entries: [] });
    await settle();

    expect(model.model()).toBeNull();
    expect(model.rows()).toEqual([]);
  });

  it('toggle_collapsesAnExpandedSolutionFolder', async () => {
    project.model = sampleModel();
    const model: SolutionModel = build();
    root.set({ path: '/root', name: 'root', entries: [] });
    await settle();

    model.toggle(rowFor(model, 'Group')!);

    // Collapsing Group hides its child project A.
    expect(labels(model)).toEqual(['Group', 'B']);
  });

  it('toggle_expandingAProject_loadsAndShowsItsContents', async () => {
    project.model = sampleModel();
    project.itemsByPath.set('/root/A/A.csproj', sampleItems());
    const model: SolutionModel = build();
    root.set({ path: '/root', name: 'root', entries: [] });
    await settle();

    model.toggle(rowFor(model, 'A')!);
    await flush();

    expect(project.itemRequests).toEqual(['/root/A/A.csproj']);
    // A's contents appear under it; the sub-folder is collapsed so its file is hidden.
    expect(labels(model)).toEqual(['Group', 'A', 'Sub', 'g.cs', 'B']);
    expect(rowFor(model, 'g.cs')?.kind).toBe('file');
    expect(rowFor(model, 'g.cs')?.expandable).toBe(false);
  });

  it('toggle_expandingAProject_marksItLoadingUntilContentsArrive', async () => {
    project.model = sampleModel();
    project.itemsByPath.set('/root/A/A.csproj', sampleItems());
    project.deferItems = true;
    const model: SolutionModel = build();
    root.set({ path: '/root', name: 'root', entries: [] });
    await settle();

    model.toggle(rowFor(model, 'A')!);
    expect(rowFor(model, 'A')?.loading).toBe(true);

    project.resolvePending('/root/A/A.csproj');
    await flush();
    expect(rowFor(model, 'A')?.loading).toBe(false);
  });

  it('onProjectLoad_marksProjectsLoadingThenClearsEachAsItCompletes', async () => {
    project.model = sampleModel();
    const model: SolutionModel = build();
    root.set({ path: '/root', name: 'root', entries: [] });
    await settle();

    lsp.emit({ rootPath: '/root', event: 'started', projectPath: null });
    expect(rowFor(model, 'A')?.loading).toBe(true);
    expect(rowFor(model, 'B')?.loading).toBe(true);

    lsp.emit({ rootPath: '/root', event: 'loaded', projectPath: '/root/A/A.csproj' });
    expect(rowFor(model, 'A')?.loading).toBe(false);
    expect(rowFor(model, 'B')?.loading).toBe(true);

    lsp.emit({ rootPath: '/root', event: 'complete', projectPath: null });
    expect(rowFor(model, 'B')?.loading).toBe(false);
  });

  it('onProjectLoad_ignoresEventsForOtherRoots', async () => {
    project.model = sampleModel();
    const model: SolutionModel = build();
    root.set({ path: '/root', name: 'root', entries: [] });
    await settle();

    lsp.emit({ rootPath: '/elsewhere', event: 'started', projectPath: null });

    expect(rowFor(model, 'A')?.loading).toBe(false);
    expect(rowFor(model, 'B')?.loading).toBe(false);
  });
});
