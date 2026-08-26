import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { TreeRow } from '@shared/angular/components/tree-view/tree-view';
import { Icon } from '@shared/angular/icons/icon';
import {
  ApiEnvironment,
  ApiFolder,
  ApiRequest,
  HttpOutcome,
  ResolvedHttpRequest,
} from '@shared/api/api-client-types';
import { ApiHttp } from '../../api-http/api-http';
import { ApiPrompts } from '../../api-prompts/api-prompts';
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
      providers: [ApiWorkspace, ApiPrompts, { provide: ApiHttp, useClass: FakeHttp }],
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

  it('onMoreAction_newCollection_raisesTheSharedDialogRatherThanAddingOneOutright', () => {
    const prompts: ApiPrompts = TestBed.inject(ApiPrompts);
    const before: number = workspace.folders().length;

    panel().onMoreAction('new-collection');
    fixture.detectChanges();

    // The dialog is the view's, so the menu and the ribbon's New group raise the same one.
    expect(prompts.collectionOpen()).toBe(true);
    expect(workspace.folders()).toHaveLength(before);
  });

  it('onMoreAction_newEnvironment_raisesTheSharedDialog', () => {
    const prompts: ApiPrompts = TestBed.inject(ApiPrompts);

    panel().onMoreAction('new-environment');
    fixture.detectChanges();

    expect(prompts.environmentOpen()).toBe(true);
  });

  it('collectionAddedElsewhere_isUnfoldedAndSelected', () => {
    const prompts: ApiPrompts = TestBed.inject(ApiPrompts);

    // Added through the ribbon's dialog rather than this panel: it must still arrive open, or it
    // reads as though nothing happened.
    prompts.promptCollection();
    prompts.collectionName.set('Orders');
    const created: ApiFolder | null = prompts.confirmCollection();
    workspace.addRequest(created!.id, { name: 'List orders' });
    fixture.detectChanges();

    expect(labels()).toContain('List orders');
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

  describe('row context menu', () => {
    /**
     * Gets the row standing for a given label.
     * @param label The row's label.
     * @returns Returns the tree row.
     */
    function rowFor(label: string): TreeRow {
      const row: TreeRow | undefined = panel()
        .rows()
        .find(
          (candidate: TreeRow): boolean => (candidate.data as { label: string }).label === label,
        );
      if (row === undefined) {
        throw new Error(`No row labelled ${label}`);
      }
      return row;
    }

    /**
     * Gets the ids the menu offers for a row, dropping the separators.
     * @param row The row to open a menu on.
     * @returns Returns the item ids.
     */
    function itemIds(row: TreeRow): readonly string[] {
      return component
        .contextMenuFor(row)
        .filter((item: MenuItem): boolean => item.separator !== true)
        .map((item: MenuItem): string => item.id);
    }

    it('contextMenuFor_theEnvironmentsHeader_offersNothingSoNoMenuOpens', () => {
      // The header is synthetic — it stands for nothing that can be renamed or removed — and an empty
      // panel on it would read as a bug rather than as an answer.
      panel().expandAll();
      fixture.detectChanges();

      expect(component.contextMenuFor(rowFor('Environments'))).toEqual([]);
    });

    it('contextMenuFor_aCollection_offersNewRequestRenameAndDelete', () => {
      const collection: ApiFolder = workspace.addCollection('Orders');
      fixture.detectChanges();

      expect(itemIds(rowFor(collection.name))).toEqual(['new-request', 'rename', 'delete']);
    });

    it('contextMenuFor_aRequest_offersRenameDuplicateAndDelete', () => {
      const collection: ApiFolder = workspace.addCollection('Orders');
      workspace.addRequest(collection.id, { name: 'Get order' });
      panel().expandAll();
      fixture.detectChanges();

      expect(itemIds(rowFor('Get order'))).toEqual(['rename', 'duplicate', 'delete']);
    });

    it('contextMenuFor_theActiveEnvironment_omitsSetAsActive', () => {
      // Activating what is already active is not a command, and a permanently greyed row on the one
      // environment the user reaches for most reads as something broken.
      const environment: ApiEnvironment = workspace.addEnvironment('Staging');
      workspace.activateEnvironment(environment.id);
      panel().expandAll();
      fixture.detectChanges();

      expect(itemIds(rowFor('Staging'))).not.toContain('activate');
    });

    it('contextMenuFor_anInactiveEnvironment_offersSetAsActive', () => {
      const active: ApiEnvironment = workspace.addEnvironment('Staging');
      workspace.addEnvironment('Production');
      workspace.activateEnvironment(active.id);
      panel().expandAll();
      fixture.detectChanges();

      expect(itemIds(rowFor('Production'))).toContain('activate');
    });

    it('contextMenuFor_delete_wearsTheDangerTone', () => {
      const collection: ApiFolder = workspace.addCollection('Orders');
      fixture.detectChanges();

      const remove: MenuItem | undefined = component
        .contextMenuFor(rowFor(collection.name))
        .find((item: MenuItem): boolean => item.id === 'delete');
      expect(remove?.tone).toBe('danger');
    });

    it('onContextAction_newRequest_addsItToTheRightClickedCollection', () => {
      // The toolbar has to guess which collection was meant; a row menu already knows.
      workspace.addCollection('First');
      const second: ApiFolder = workspace.addCollection('Second');
      fixture.detectChanges();

      component.onContextAction({ itemId: 'new-request', row: rowFor('Second') });

      expect(
        workspace
          .requests()
          .filter((request: ApiRequest): boolean => request.parentId === second.id),
      ).toHaveLength(1);
    });

    it('onContextAction_setAsActive_activatesThatEnvironment', () => {
      workspace.addEnvironment('Staging');
      const production: ApiEnvironment = workspace.addEnvironment('Production');
      panel().expandAll();
      fixture.detectChanges();

      component.onContextAction({ itemId: 'activate', row: rowFor('Production') });

      expect(workspace.activeEnvironmentId()).toBe(production.id);
    });

    it('onContextAction_rename_opensTheDialogStartedFromTheCurrentName', () => {
      const collection: ApiFolder = workspace.addCollection('Orders');
      fixture.detectChanges();

      component.onContextAction({ itemId: 'rename', row: rowFor(collection.name) });

      expect(component.renameTarget()?.id).toBe(collection.id);
      expect(component.renameName()).toBe('Orders');
    });

    it('confirmRename_aCollection_renamesIt', () => {
      const collection: ApiFolder = workspace.addCollection('Orders');
      fixture.detectChanges();
      component.onContextAction({ itemId: 'rename', row: rowFor(collection.name) });
      component.renameName.set('  Fulfilment  ');

      component.confirmRename();

      expect(
        workspace.folders().find((folder: ApiFolder): boolean => folder.id === collection.id)?.name,
      ).toBe('Fulfilment');
      expect(component.renameTarget()).toBeNull();
    });

    it('confirmRename_aRequest_renamesIt', () => {
      const collection: ApiFolder = workspace.addCollection('Orders');
      const request: ApiRequest = workspace.addRequest(collection.id, { name: 'Get order' });
      panel().expandAll();
      fixture.detectChanges();
      component.onContextAction({ itemId: 'rename', row: rowFor('Get order') });
      component.renameName.set('Fetch order');

      component.confirmRename();

      expect(
        workspace.requests().find((candidate: ApiRequest): boolean => candidate.id === request.id)
          ?.name,
      ).toBe('Fetch order');
    });

    it('confirmRename_aBlankName_changesNothing', () => {
      const collection: ApiFolder = workspace.addCollection('Orders');
      fixture.detectChanges();
      component.onContextAction({ itemId: 'rename', row: rowFor(collection.name) });
      component.renameName.set('   ');

      component.confirmRename();

      expect(
        workspace.folders().find((folder: ApiFolder): boolean => folder.id === collection.id)?.name,
      ).toBe('Orders');
    });

    it('onContextAction_duplicate_copiesTheRequestAndSelectsTheCopy', () => {
      const collection: ApiFolder = workspace.addCollection('Orders');
      workspace.addRequest(collection.id, { name: 'Get order' });
      panel().expandAll();
      fixture.detectChanges();

      component.onContextAction({ itemId: 'duplicate', row: rowFor('Get order') });

      const names: readonly string[] = workspace
        .requests()
        .filter((request: ApiRequest): boolean => request.parentId === collection.id)
        .map((request: ApiRequest): string => request.name);
      expect(names).toContain('Get order copy');
    });

    it('onContextAction_delete_asksBeforeRemovingAnything', () => {
      const collection: ApiFolder = workspace.addCollection('Orders');
      fixture.detectChanges();

      component.onContextAction({ itemId: 'delete', row: rowFor(collection.name) });

      expect(component.deleteTarget()?.id).toBe(collection.id);
      expect(
        workspace.folders().some((folder: ApiFolder): boolean => folder.id === collection.id),
      ).toBe(true);
    });

    it('confirmDelete_aCollection_removesItAndItsRequests', () => {
      const collection: ApiFolder = workspace.addCollection('Orders');
      workspace.addRequest(collection.id, { name: 'Get order' });
      fixture.detectChanges();
      component.onContextAction({ itemId: 'delete', row: rowFor(collection.name) });

      component.confirmDelete();

      expect(
        workspace.folders().some((folder: ApiFolder): boolean => folder.id === collection.id),
      ).toBe(false);
      expect(
        workspace
          .requests()
          .some((request: ApiRequest): boolean => request.parentId === collection.id),
      ).toBe(false);
    });

    it('confirmDelete_theActiveEnvironment_leavesNoDanglingActiveId', () => {
      const environment: ApiEnvironment = workspace.addEnvironment('Staging');
      workspace.activateEnvironment(environment.id);
      panel().expandAll();
      fixture.detectChanges();
      component.onContextAction({ itemId: 'delete', row: rowFor('Staging') });

      component.confirmDelete();

      expect(workspace.activeEnvironmentId()).not.toBe(environment.id);
    });

    it('cancelDelete_removesNothing', () => {
      const collection: ApiFolder = workspace.addCollection('Orders');
      fixture.detectChanges();
      component.onContextAction({ itemId: 'delete', row: rowFor(collection.name) });

      component.cancelDelete();
      component.confirmDelete();

      expect(
        workspace.folders().some((folder: ApiFolder): boolean => folder.id === collection.id),
      ).toBe(true);
    });
  });
});
