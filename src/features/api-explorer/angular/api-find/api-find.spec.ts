import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FindResultItem } from '@shared/angular/components/find-panel/find-adapter';
import {
  FakeCodeEditor,
  FakeTextModel,
} from '@shared/angular/components/search-view/testing/fake-text-model';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { DockFloating } from '@shared/angular/services/dock-layout/dock-floating';
import { DOCK_BLUEPRINT } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { findStackOfPanel, firstStackOfRole } from '@shared/angular/services/dock-layout/dock-tree';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { Icon } from '@shared/angular/icons/icon';
import type { ApiRequest } from '@shared/api/api-client-types';
import { API_EXPLORER_DOCK_BLUEPRINT } from '../api-explorer-dock-blueprint';
import { ApiWorkspace } from '../api-workspace/api-workspace';
import { API_FIND_PANEL_ID, ApiFind } from './api-find';

/**
 * A body's editor that can be disposed.
 */
class BodyEditor extends FakeCodeEditor {
  private disposed: (() => void) | null = null;

  public constructor(text: string, readOnly: boolean = false) {
    super(new FakeTextModel([text]));
    this.readOnly = readOnly;
  }

  public onDidDispose(listener: () => void): void {
    this.disposed = listener;
  }

  public dispose(): void {
    this.disposed?.();
  }
}

describe('ApiFind (#1564)', () => {
  let find: ApiFind;
  let dock: DockState;

  /**
   * Opens a request in the well, in front.
   * @param id The request's id.
   */
  function openRequest(id: string): void {
    TestBed.inject(DockPanelRegistry).register({
      id,
      title: id,
      icon: Icon.API_REQUEST,
      role: 'document',
      component: Object,
    });
    const well: StackNode = firstStackOfRole(dock.layout(), 'document')!;
    dock.tabInto(well.id, id);
    TestBed.tick();
  }

  /**
   * Brings an open request to the front of its group.
   * @param id The request's id.
   */
  function bringForward(id: string): void {
    dock.setActive(findStackOfPanel(dock.layout(), id)!.id, id);
    TestBed.tick();
  }

  /**
   * Presses ⌘F in a body.
   * @param editor The body's editor.
   */
  function findIn(editor: BodyEditor): void {
    find.openFind({ mode: 'find', scope: 'file', seed: 'todo' }, editor.asEditor());
    TestBed.tick();
  }

  /**
   * Searches for the word every body holds.
   * @returns Returns which bodies it was found in.
   */
  function foundIn(): readonly (string | undefined)[] {
    find.search.adapter.setQuery({
      text: 'todo',
      caseSensitive: false,
      wholeWord: false,
      regexp: false,
    });
    return find.search.adapter
      .matches()
      .map((item: FindResultItem): string | undefined => item.file);
  }

  beforeEach(() => {
    localStorage.clear();
    const requests: WritableSignal<readonly ApiRequest[]> = signal<readonly ApiRequest[]>([
      { id: 'one', name: 'First' } as ApiRequest,
      { id: 'two', name: 'Second' } as ApiRequest,
    ]);
    TestBed.configureTestingModule({
      providers: [
        { provide: DOCK_BLUEPRINT, useValue: API_EXPLORER_DOCK_BLUEPRINT },
        { provide: ApiWorkspace, useValue: { requests } },
      ],
    });
    dock = TestBed.inject(DockState);
    find = TestBed.inject(ApiFind);
    openRequest('one');
  });

  afterEach(() => localStorage.clear());

  describe('the panel', () => {
    it('openFind_theFirstTime_addsItBesideTheAgentAndInFront', () => {
      const body: BodyEditor = new BodyEditor('todo');
      find.attach('one', body.asEditor());
      expect(findStackOfPanel(dock.layout(), API_FIND_PANEL_ID)).toBeNull();

      findIn(body);

      const stack: StackNode | null = findStackOfPanel(dock.layout(), API_FIND_PANEL_ID);
      expect(stack?.panels).toEqual(['agent', API_FIND_PANEL_ID]);
      expect(stack?.active).toBe(API_FIND_PANEL_ID);
    });

    it('openFind_withNoAgentInTheLayout_docksItOnTheRight', async () => {
      const body: BodyEditor = new BodyEditor('todo');
      find.attach('one', body.asEditor());
      await dock.requestClose('agent');

      findIn(body);

      expect(findStackOfPanel(dock.layout(), API_FIND_PANEL_ID)?.panels).toEqual([
        API_FIND_PANEL_ID,
      ]);
    });

    it('openFind_whenItWasMoved_leavesItWhereItWasPut', () => {
      const body: BodyEditor = new BodyEditor('todo');
      find.attach('one', body.asEditor());
      const bottom: StackNode = findStackOfPanel(dock.layout(), 'history')!;
      dock.tabInto(bottom.id, API_FIND_PANEL_ID);
      dock.setActive(bottom.id, 'history');

      findIn(body);

      const stack: StackNode | null = findStackOfPanel(dock.layout(), API_FIND_PANEL_ID);
      expect(stack?.id).toBe(bottom.id);
      expect(stack?.active).toBe(API_FIND_PANEL_ID);
    });

    it('openFind_whenItFloats_addsNoSecondOne', () => {
      const body: BodyEditor = new BodyEditor('todo');
      find.attach('one', body.asEditor());
      findIn(body);
      TestBed.inject(DockFloating).float(API_FIND_PANEL_ID, {
        left: 0,
        top: 0,
        width: 300,
        height: 300,
      });

      findIn(body);

      expect(findStackOfPanel(dock.layout(), API_FIND_PANEL_ID)).toBeNull();
    });
  });

  describe('what is searched', () => {
    it('openFind_searchesTheBodyItWasPressedIn_andNamesItsRequest', () => {
      const request: BodyEditor = new BodyEditor('todo');
      const response: BodyEditor = new BodyEditor('todo todo', true);
      find.attach('one', request.asEditor());
      find.attach('one', response.asEditor());

      findIn(response);

      expect(foundIn()).toEqual(['First — Response Body', 'First — Response Body']);
      expect(find.search.replaceable()).toBe(false);
    });

    it('anotherRequestInFront_isSearchedInstead', () => {
      const first: BodyEditor = new BodyEditor('todo');
      const second: BodyEditor = new BodyEditor('todo');
      find.attach('one', first.asEditor());
      findIn(first);

      openRequest('two');
      find.attach('two', second.asEditor());
      bringForward('two');

      expect(foundIn()).toEqual(['Second — Request Body']);
    });

    it('aRequestComingBack_isSearchedWhereItLastWas', () => {
      const request: BodyEditor = new BodyEditor('todo');
      const response: BodyEditor = new BodyEditor('todo', true);
      find.attach('one', request.asEditor());
      find.attach('one', response.asEditor());
      findIn(response);

      openRequest('two');
      bringForward('two');
      bringForward('one');

      expect(foundIn()).toEqual(['First — Response Body']);
    });

    it('aRequestNotYetSearched_startsWithTheBodyThatCanBeEdited', () => {
      const response: BodyEditor = new BodyEditor('todo', true);
      const request: BodyEditor = new BodyEditor('todo');
      find.attach('one', response.asEditor());
      find.attach('one', request.asEditor());
      TestBed.tick();

      expect(foundIn()).toEqual(['First — Request Body']);
    });

    it('aRequestWithNoBodyOpen_hasNothingToSearch', () => {
      const first: BodyEditor = new BodyEditor('todo');
      find.attach('one', first.asEditor());
      findIn(first);
      expect(find.hasTarget()).toBe(true);

      openRequest('two');
      bringForward('two');

      expect(find.hasTarget()).toBe(false);
      expect(foundIn()).toEqual([]);
    });

    it('aBodyThatCloses_isLetGoOf', () => {
      const request: BodyEditor = new BodyEditor('todo');
      const response: BodyEditor = new BodyEditor('todo', true);
      find.attach('one', request.asEditor());
      find.attach('one', response.asEditor());
      findIn(request);

      request.dispose();
      TestBed.tick();

      expect(foundIn()).toEqual(['First — Response Body']);
    });

    it('theFocusedGroup_decidesWhichRequestIsInFront', () => {
      const first: BodyEditor = new BodyEditor('todo');
      const second: BodyEditor = new BodyEditor('todo');
      openRequest('two');
      dock.splitPanelOut('two', 'right');
      find.attach('one', first.asEditor());
      find.attach('two', second.asEditor());
      const focus: DockFocus = TestBed.inject(DockFocus);

      focus.focus(findStackOfPanel(dock.layout(), 'two')!.id);
      TestBed.tick();
      expect(foundIn()).toEqual(['Second — Request Body']);

      focus.focus(findStackOfPanel(dock.layout(), 'one')!.id);
      TestBed.tick();
      expect(foundIn()).toEqual(['First — Request Body']);

      // A tool group taking focus — Find's own, say — changes nothing.
      focus.focus(findStackOfPanel(dock.layout(), 'agent')!.id);
      TestBed.tick();
      expect(foundIn()).toEqual(['First — Request Body']);
    });
  });
});
