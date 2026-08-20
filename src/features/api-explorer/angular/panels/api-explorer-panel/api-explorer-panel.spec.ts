import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { TreeRow } from '@shared/angular/components/tree-view/tree-view';
import { Icon } from '@shared/angular/icons/icon';
import { ApiFolder, HttpOutcome, ResolvedHttpRequest } from '@shared/api/api-client-types';
import { ApiHttp } from '../../api-http/api-http';
import { ApiWorkspace } from '../../api-workspace/api-workspace';
import { ApiExplorerPanel } from './api-explorer-panel';

/**
 * A stand-in engine, so the panel's tests never reach a socket.
 */
class FakeHttp {
  /**
   * Resolves an empty response for any send.
   * @returns Returns a stubbed outcome.
   */
  public send(): Promise<HttpOutcome> {
    return Promise.resolve({
      kind: 'response',
      id: '',
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '',
      sizeBytes: 0,
      finalUrl: '',
      redirected: false,
      timings: { firstByteMs: 0, totalMs: 0 },
    } as HttpOutcome);
  }

  /**
   * Records nothing: no test cancels.
   */
  public cancel(): void {
    // Intentionally empty.
  }

  /**
   * Never called; present so the fake satisfies the client's shape.
   * @param request The resolved request.
   * @returns Returns the request, unused.
   */
  public resolve(request: ResolvedHttpRequest): ResolvedHttpRequest {
    return request;
  }
}

describe('ApiExplorerPanel', () => {
  let component: ApiExplorerPanel;
  let fixture: ComponentFixture<ApiExplorerPanel>;
  let workspace: ApiWorkspace;

  /**
   * Reads the panel's protected members, which are what the template binds to.
   */
  interface PanelInternals {
    readonly rows: () => readonly TreeRow[];
    readonly query: { set: (value: string) => void };
    readonly moreItems: () => readonly MenuItem[];
    expandAll(): void;
    collapseAll(): void;
    onMoreAction(id: string): void;
  }

  /**
   * Gets the panel's internals for assertion.
   * @returns Returns the panel, typed to its protected surface.
   */
  function panel(): PanelInternals {
    return component as unknown as PanelInternals;
  }

  /**
   * Gets the labels of the rendered rows, in order.
   * @returns Returns each row's label.
   */
  function labels(): string[] {
    return panel()
      .rows()
      .map((row: TreeRow): string => (row.data as { label: string }).label);
  }

  beforeEach(async () => {
    globalThis.localStorage?.clear();
    await TestBed.configureTestingModule({
      imports: [ApiExplorerPanel],
      providers: [ApiWorkspace, { provide: ApiHttp, useClass: FakeHttp }],
    }).compileComponents();

    fixture = TestBed.createComponent(ApiExplorerPanel);
    component = fixture.componentInstance;
    workspace = TestBed.inject(ApiWorkspace);
    fixture.componentRef.setInput('panel', {
      id: 'apis',
      title: 'API Explorer',
      icon: Icon.API_EXPLORER,
      role: 'tool',
      component: ApiExplorerPanel,
    } satisfies DockPanel);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_wearsTheSharedExplorerToolbar', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('app-explorer-toolbar')).not.toBeNull();
    // Search, expand-all, collapse-all and the more-actions menu, exactly as the Solution Explorer.
    expect(element.querySelector('app-text-field[kind="search"]')).not.toBeNull();
    expect(element.querySelectorAll('app-explorer-toolbar app-button')).toHaveLength(3);
  });

  it('moreItems_offersTheThreeAddCommands', () => {
    expect(
      panel()
        .moreItems()
        .map((item: MenuItem): string => item.label),
    ).toEqual(['New Collection', 'New Environment', 'New Request']);
  });

  it('moreItems_whenThereIsNoCollection_disablesNewRequestRatherThanHidingIt', () => {
    for (const folder of workspace.folders()) {
      workspace.removeFolder(folder.id);
    }
    fixture.detectChanges();

    const request: MenuItem | undefined = panel()
      .moreItems()
      .find((item: MenuItem): boolean => item.label === 'New Request');
    expect(request?.disabled).toBe(true);
  });

  it('onMoreAction_newCollection_opensTheNamingDialogRatherThanAddingOneOutright', () => {
    const before: number = workspace.folders().length;

    panel().onMoreAction('new-collection');
    fixture.detectChanges();

    expect(workspace.folders()).toHaveLength(before);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('New collection');
  });

  it('collapseAll_thenExpandAll_foldsAndUnfoldsEveryBranch', () => {
    const collection: ApiFolder = workspace.addCollection('Orders');
    workspace.addRequest(collection.id, { name: 'List orders' });
    fixture.detectChanges();

    panel().collapseAll();
    fixture.detectChanges();
    expect(labels()).not.toContain('List orders');

    panel().expandAll();
    fixture.detectChanges();
    expect(labels()).toContain('List orders');
    expect(labels()).toContain('Environments');
  });

  it('query_filtersToMatchingRowsAndShowsThemWithoutUnfolding', () => {
    const collection: ApiFolder = workspace.addCollection('Orders');
    workspace.addRequest(collection.id, { name: 'List orders' });
    workspace.addRequest(collection.id, { name: 'Delete order' });
    panel().collapseAll();
    fixture.detectChanges();

    panel().query.set('list');
    fixture.detectChanges();

    // The match is visible even though its collection is folded, and its collection is shown with it.
    expect(labels()).toContain('List orders');
    expect(labels()).toContain('Orders');
    expect(labels()).not.toContain('Delete order');
  });

  it('query_whenACollectionMatches_bringsItsRequestsWithIt', () => {
    const collection: ApiFolder = workspace.addCollection('Orders');
    workspace.addRequest(collection.id, { name: 'Anything' });
    fixture.detectChanges();

    panel().query.set('orders');
    fixture.detectChanges();

    expect(labels()).toContain('Anything');
  });

  it('query_whenNothingMatches_dropsTheGroupsToo', () => {
    panel().query.set('zzzz-no-such-thing');
    fixture.detectChanges();

    expect(labels()).toEqual([]);
  });
});
