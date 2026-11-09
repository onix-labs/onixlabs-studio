import {
  ChangeDetectionStrategy,
  Component,
  getDebugNode,
  input,
  InputSignal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Mock } from 'vitest';
import {
  AuxiliaryWindow,
  AuxiliaryWindowPosition,
  AuxiliaryWindows,
} from '@shared/angular/services/auxiliary-windows/auxiliary-windows';
import { Icon } from '@shared/angular/icons/icon';
import { DOCK_BLUEPRINT } from '@shared/angular/services/dock-layout/dock-blueprint';
import { DockAutoHide } from '@shared/angular/services/dock-layout/dock-auto-hide';
import { DockDrag, ExternalDropHandler } from '@shared/angular/services/dock-layout/dock-drag';
import { DockFloating } from '@shared/angular/services/dock-layout/dock-floating';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { DockGeometry } from '@shared/angular/services/dock-layout/dock-geometry';
import { DockMinimums } from '@shared/angular/services/dock-layout/dock-minimums';
import {
  DockNode,
  mkSplit,
  mkStack,
  StackNode,
} from '@shared/angular/services/dock-layout/dock-node';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DockPanelAvailability } from '@shared/angular/services/dock-layout/dock-panel-availability';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { DockTabContext } from '@shared/angular/services/dock-layout/dock-tab-context';
import {
  collectPanelIds,
  findPrimaryStack,
  findStackOfPanel,
  firstStackOfRole,
} from '@shared/angular/services/dock-layout/dock-tree';
import { PopoutPanels } from '@shared/angular/services/dock-layout/popout-panels';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { PanelPopout } from './panel-popout';

/**
 * Stands in for a panel's content.
 */
@Component({
  selector: 'app-stub-panel',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubPanel {
  public readonly panel: InputSignal<DockPanel | undefined> = input<DockPanel>();
}

/**
 * A tool panel.
 */
function tool(id: string): DockPanel {
  return { id, title: id, icon: Icon.LIST_ALL, role: 'tool', component: StubPanel };
}

/**
 * A document panel.
 */
function documentPanel(id: string): DockPanel {
  return { ...tool(id), role: 'document' };
}

/**
 * A fake OS window: real elements to render into, and a screen rectangle it occupies.
 */
class FakeWindow implements AuxiliaryWindow {
  public readonly contentHost: HTMLElement = document.body.appendChild(
    document.createElement('div'),
  );
  public readonly titlebar: HTMLElement = document.body.appendChild(document.createElement('div'));
  public focusCount: number = 0;
  public closeCount: number = 0;
  public over: boolean = false;
  private readonly listeners: (() => void)[] = [];

  public constructor(
    public readonly title: string,
    public readonly at: AuxiliaryWindowPosition | undefined,
  ) {}

  public containsScreenPoint(): boolean {
    return this.over;
  }

  public focus(): void {
    this.focusCount += 1;
  }

  public close(): void {
    this.closeCount += 1;
    this.contentHost.remove();
    this.titlebar.remove();
    for (const listener of this.listeners) {
      listener();
    }
  }

  public onClosed(listener: () => void): void {
    this.listeners.push(listener);
  }

  /**
   * Reads the dock state of the dock rendered into this window.
   */
  public dock(): DockState {
    const element: Element | null = this.contentHost.firstElementChild;
    const state: DockState | undefined =
      element === null ? undefined : getDebugNode(element)?.injector.get(DockState);
    if (state === undefined) {
      throw new Error('No dock was rendered into the window');
    }
    return state;
  }
}

/**
 * A fake opener, which can refuse.
 */
class FakeWindows {
  public readonly opened: FakeWindow[] = [];
  public refusing: boolean = false;

  public open(title: string, at?: AuxiliaryWindowPosition): AuxiliaryWindow | null {
    if (this.refusing) {
      return null;
    }
    const opened: FakeWindow = new FakeWindow(title, at);
    this.opened.push(opened);
    return opened;
  }
}

/**
 * A release event at the given client and screen points.
 */
function drop(clientX: number, clientY: number, screenX: number, screenY: number): MouseEvent {
  return new MouseEvent('mouseup', { clientX, clientY, screenX, screenY });
}

describe('PanelPopout', () => {
  let windows: FakeWindows;
  let popout: PanelPopout;
  let state: DockState;
  let popped: PopoutPanels;
  let drops: ExternalDropHandler[];
  let liveDrops: Set<ExternalDropHandler>;
  let seed: (() => DockNode) | null;

  /**
   * Lets the windows' membership watchers run.
   */
  async function flush(): Promise<void> {
    TestBed.tick();
    await Promise.resolve();
    TestBed.tick();
  }

  /**
   * Gets the window opened at the given index.
   */
  function opened(index: number): FakeWindow {
    const found: FakeWindow | undefined = windows.opened[index];
    if (found === undefined) {
      throw new Error(`No window ${index}`);
    }
    return found;
  }

  /**
   * Gets the stack a panel sits in on the main dock.
   */
  function stackOf(panelId: string): StackNode | null {
    return findStackOfPanel(state.layout(), panelId);
  }

  beforeEach((): void => {
    windows = new FakeWindows();
    seed = null;
    drops = [];
    liveDrops = new Set<ExternalDropHandler>();
    const original: DockDrag['registerExternalDrop'] =
      // eslint-disable-next-line @typescript-eslint/unbound-method
      DockDrag.prototype.registerExternalDrop;
    vi.spyOn(DockDrag.prototype, 'registerExternalDrop').mockImplementation(function (
      this: DockDrag,
      handler: ExternalDropHandler,
    ): () => void {
      drops.push(handler);
      liveDrops.add(handler);
      const release: () => void = original.call(this, handler);
      return (): void => {
        liveDrops.delete(handler);
        release();
      };
    });
    const left: StackNode = mkStack('tool', ['files', 'search', 'errors']);
    const right: StackNode = mkStack('tool', ['agent']);
    TestBed.configureTestingModule({
      providers: [
        DockTabContext,
        DockState,
        DockGeometry,
        DockMinimums,
        DockFocus,
        DockPanelRegistry,
        DockPanelAvailability,
        DockFloating,
        DockAutoHide,
        DockDrag,
        DockReveal,
        PopoutPanels,
        PanelPopout,
        { provide: AuxiliaryWindows, useValue: windows },
        {
          provide: DOCK_BLUEPRINT,
          useValue: {
            panels: [
              ...['files', 'search', 'errors', 'agent', 'logs'].map(tool),
              documentPanel('readme'),
              documentPanel('notes'),
            ],
            createLayout: (): DockNode =>
              seed?.() ??
              ({
                kind: 'split',
                id: 'split',
                orientation: 'horizontal',
                children: [left, right],
                sizes: [1, 1],
              } as unknown as DockNode),
          },
        },
      ],
    });
    state = TestBed.inject(DockState);
    popped = TestBed.inject(PopoutPanels);
    popout = TestBed.inject(PanelPopout);
  });

  afterEach((): void => {
    vi.restoreAllMocks();
    for (const opening of windows.opened) {
      opening.contentHost.remove();
      opening.titlebar.remove();
    }
  });

  describe('window teardown', () => {
    it('windowClosed_releasesItsDropHandler_soClosedWindowsDoNotBuildUp', async () => {
      for (let round: number = 0; round < 3; round += 1) {
        popout.popOut('search');
        await flush();
        opened(round).close();
        await flush();
      }

      // Only the main dock's own handler is left.
      expect(liveDrops.size).toBe(1);
      expect(drops).toHaveLength(4);
    });

    it('returnAll_releasesEveryWindowsDropHandler', async () => {
      popout.popOut('search');
      popout.popOut('errors');
      await flush();

      popout.returnAll();

      expect(liveDrops.size).toBe(1);
    });

    it('viewDestroyed_releasesTheMainAndWindowDropHandlers', async () => {
      popout.popOut('search');
      await flush();

      popout.ngOnDestroy();

      expect(liveDrops.size).toBe(0);
    });
  });

  describe('popping out', () => {
    it('popOut_movesThePanelOutOfTheMainDock', async () => {
      popout.popOut('search');
      await flush();

      expect(collectPanelIds(state.layout())).not.toContain('search');
      expect(popped.isPopped('search')).toBe(true);
      expect(collectPanelIds(opened(0).dock().layout())).toEqual(['search']);
    });

    it('popOut_throughTheChromeSeam_works', () => {
      popped.popOut('search');

      expect(windows.opened).toHaveLength(1);
    });

    it('popOut_unknownPanel_opensNothing', () => {
      popout.popOut('nope');

      expect(windows.opened).toEqual([]);
    });

    it('popOut_windowRefused_leavesThePanelDocked', () => {
      windows.refusing = true;

      popout.popOut('search');

      expect(stackOf('search')).not.toBeNull();
      expect(popped.isPopped('search')).toBe(false);
    });

    it('popOut_again_focusesTheWindowItIsIn', () => {
      popout.popOut('search');

      popout.popOut('search');

      expect(windows.opened).toHaveLength(1);
      expect(opened(0).focusCount).toBe(1);
    });

    it('focusPopped_focusesItsWindow', () => {
      popout.popOut('search');

      popped.focusPopped('search');

      expect(opened(0).focusCount).toBe(1);
    });

    it.each([
      [null, '/work/project', 'project'],
      [null, 'C:\\work\\project', 'project'],
      ['Project — main', '/work/guid', 'Project — main'],
      [null, null, 'ONIXLabs Studio'],
    ])('title_%s_%s_is_%s', (name: string | null, root: string | null, title: string) => {
      const context: DockTabContext = TestBed.inject(DockTabContext);
      context.setDisplayName(name);
      context.setRoot(root);

      popout.popOut('search');

      expect(opened(0).title).toBe(title);
    });

    it('keydown_inTheWindow_dispatchesInTheOwningViewsScope', () => {
      TestBed.inject(DockTabContext).setTabId('view-1');
      const dispatch: Mock = vi
        .spyOn(TestBed.inject(Keybindings), 'dispatch')
        .mockReturnValue(true);
      popout.popOut('search');

      const event: KeyboardEvent = new KeyboardEvent('keydown', { key: 'p', cancelable: true });
      window.dispatchEvent(event);

      expect(dispatch.mock.calls[0]?.[1]).toBe('view-1');
      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('closing a window', () => {
    it('close_returnsThePanelToTheTabItLeft', async () => {
      popout.popOut('search');
      await flush();

      opened(0).close();

      expect(stackOf('search')?.panels).toEqual(['files', 'search', 'errors']);
      expect(popped.isPopped('search')).toBe(false);
    });

    it('close_revealsThePanelReturned', async () => {
      popout.popOut('search');
      await flush();

      opened(0).close();

      expect(stackOf('search')?.active).toBe('search');
    });

    it('close_lastPanelOfAStack_comesBack', async () => {
      popout.popOut('agent');
      await flush();

      opened(0).close();

      expect(stackOf('agent')).not.toBeNull();
      expect(popped.isPopped('agent')).toBe(false);
    });

    it('close_originStackEmptied_stillReturnsThePanel', async () => {
      popout.popOut('search');
      await flush();
      state.removeFromLayout('files');
      state.removeFromLayout('errors');

      opened(0).close();

      expect(stackOf('search')?.panels).toEqual(['search']);
    });

    it('close_emptiesNoOtherWindow', async () => {
      popout.popOut('search');
      popout.popOut('errors');
      await flush();

      opened(0).close();
      await flush();

      expect(popped.isPopped('errors')).toBe(true);
      expect(opened(1).closeCount).toBe(0);
    });

    it('panelClosedInsideTheWindow_leavesThePoppedSetAndClosesTheWindow', async () => {
      popout.popOut('search');
      await flush();

      opened(0).dock().removeFromLayout('search');
      await flush();

      expect(popped.isPopped('search')).toBe(false);
      expect(opened(0).closeCount).toBe(1);
      expect(stackOf('search')).toBeNull();
    });
  });

  describe('dragging out of the main dock', () => {
    it('drop_documentPanel_isDeclined', () => {
      const document: DockPanel = { ...tool('doc'), role: 'document' };

      expect(drops[0]?.(document, drop(-5, 5, 0, 0))).toBe(false);
    });

    it('drop_insideTheWindow_isDeclined', () => {
      expect(drops[0]?.(tool('search'), drop(5, 5, 5, 5))).toBe(false);
      expect(windows.opened).toEqual([]);
    });

    it.each([
      [-1, 5],
      [5, -1],
      [window.innerWidth + 1, 5],
      [5, window.innerHeight + 1],
    ])('drop_outsideAt_%i_%i_tearsOut', (clientX: number, clientY: number) => {
      expect(drops[0]?.(tool('search'), drop(clientX, clientY, 500, 300))).toBe(true);

      expect(opened(0).at).toEqual({ x: 440, y: 280 });
      expect(popped.isPopped('search')).toBe(true);
    });

    it('drop_ontoAnOpenWindow_joinsItsDock', async () => {
      popout.popOut('search');
      await flush();
      opened(0).over = true;

      expect(drops[0]?.(tool('errors'), drop(-1, 5, 500, 300))).toBe(true);
      await flush();

      expect(windows.opened).toHaveLength(1);
      expect(collectPanelIds(opened(0).dock().layout())).toEqual(['search', 'errors']);
      expect(collectPanelIds(state.layout())).not.toContain('errors');
    });

    it('drop_ontoTheNewestOfTwoOverlappingWindows_joinsThatOne', async () => {
      popout.popOut('search');
      popout.popOut('files');
      await flush();
      opened(0).over = true;
      opened(1).over = true;

      drops[0]?.(tool('errors'), drop(-1, 5, 500, 300));
      await flush();

      expect(collectPanelIds(opened(1).dock().layout())).toContain('errors');
      expect(collectPanelIds(opened(0).dock().layout())).not.toContain('errors');
    });

    it('drop_afterJoiningAWindow_closingItReturnsThePanelHome', async () => {
      popout.popOut('search');
      await flush();
      opened(0).over = true;
      drops[0]?.(tool('errors'), drop(-1, 5, 500, 300));
      await flush();

      opened(0).close();

      expect(stackOf('errors')?.panels).toContain('files');
    });
  });

  describe('dragging out of a pop-out window', () => {
    /**
     * Reads the window's own drop handler.
     */
    function windowDrop(index: number): ExternalDropHandler {
      const handler: ExternalDropHandler | undefined = drops[index + 1];
      if (handler === undefined) {
        throw new Error(`No drop handler for window ${index}`);
      }
      return handler;
    }

    it('drop_insideTheWindow_isDeclined', async () => {
      popout.popOut('search');
      await flush();

      expect(windowDrop(0)(tool('search'), drop(5, 5, 5, 5))).toBe(false);
    });

    it('drop_backOverItsOwnWindow_isDeclined', async () => {
      popout.popOut('search');
      await flush();
      opened(0).over = true;

      expect(windowDrop(0)(tool('search'), drop(-1, 5, 500, 300))).toBe(false);
    });

    it('drop_ontoAnotherWindow_movesThePanelThere', async () => {
      popout.popOut('search');
      popout.popOut('errors');
      await flush();
      opened(1).over = true;

      expect(windowDrop(0)(tool('search'), drop(-1, 5, 500, 300))).toBe(true);
      await flush();

      expect(collectPanelIds(opened(1).dock().layout())).toContain('search');
      expect(opened(0).closeCount).toBe(1);
      expect(popped.isPopped('search')).toBe(true);
    });

    it('drop_overTheMainWindow_returnsItHome', async () => {
      popout.popOut('search');
      await flush();

      expect(
        windowDrop(0)(tool('search'), drop(-1, 5, window.screenX + 1, window.screenY + 1)),
      ).toBe(true);
      await flush();

      expect(stackOf('search')?.panels).toEqual(['files', 'search', 'errors']);
      expect(popped.isPopped('search')).toBe(false);
      expect(opened(0).closeCount).toBe(1);
    });

    it('drop_overNothing_tearsOutIntoANewWindow', async () => {
      popout.popOut('search');
      await flush();

      expect(windowDrop(0)(tool('search'), drop(-1, 5, 90000, 90000))).toBe(true);
      await flush();

      expect(windows.opened).toHaveLength(2);
      expect(opened(1).at).toEqual({ x: 89940, y: 89980 });
      expect(popped.isPopped('search')).toBe(true);
      expect(opened(0).closeCount).toBe(1);
    });

    it('drop_overNothing_newWindowRefused_returnsItHome', async () => {
      popout.popOut('search');
      await flush();
      windows.refusing = true;

      expect(windowDrop(0)(tool('search'), drop(-1, 5, 90000, 90000))).toBe(true);
      await flush();

      expect(stackOf('search')).not.toBeNull();
      expect(popped.isPopped('search')).toBe(false);
    });

    it('drop_movedThenClosed_stillReturnsToTheOriginalPlace', async () => {
      popout.popOut('search');
      popout.popOut('errors');
      await flush();
      opened(1).over = true;
      windowDrop(0)(tool('search'), drop(-1, 5, 500, 300));
      await flush();

      opened(1).close();

      expect(stackOf('search')?.panels.slice(0, 2)).toEqual(['files', 'search']);
    });
  });

  describe('keeping the panel kind on the way home', () => {
    /**
     * Seeds the main dock with a fresh layout.
     */
    function layout(build: () => DockNode): void {
      seed = build;
      state.reset();
    }

    /**
     * Seeds the main dock with a tool filling the centre on its own (no document well), tool groups
     * on the left and at the bottom — the arrangement of an agent docked over the whole main area.
     */
    function toolFillsTheCentre(): void {
      layout((): DockNode =>
        mkSplit('row', [
          mkStack('tool', ['files']),
          mkSplit('col', [
            { ...mkStack('tool', ['agent']), primary: true },
            mkStack('tool', ['errors', 'logs']),
          ]),
        ]),
      );
    }

    /**
     * Seeds the main dock with a document well in the centre beside a tool group.
     */
    function documentsInTheCentre(panels: readonly string[]): void {
      layout((): DockNode =>
        mkSplit('row', [mkStack('tool', ['files']), mkStack('document', panels, true)]),
      );
    }

    /**
     * Reads the window's own drop handler.
     */
    function windowDrop(index: number): ExternalDropHandler {
      const handler: ExternalDropHandler | undefined = drops[index + 1];
      if (handler === undefined) {
        throw new Error(`No drop handler for window ${index}`);
      }
      return handler;
    }

    it('toolFillingTheCentre_poppedOut_leavesAnEmptyDocumentWell', async () => {
      toolFillsTheCentre();

      popout.popOut('agent');
      await flush();

      // The precondition of the bug: the centre outlives the tool, flipped to a document well.
      expect(findPrimaryStack(state.layout())).toMatchObject({ role: 'document', panels: [] });
    });

    it('toolFillingTheCentre_windowClosed_comesBackAsATool', async () => {
      toolFillsTheCentre();
      const centre: string = stackOf('agent')?.id ?? '';
      popout.popOut('agent');
      await flush();

      opened(0).close();

      expect(stackOf('agent')).toMatchObject({
        id: centre,
        role: 'tool',
        primary: true,
        panels: ['agent'],
        active: 'agent',
      });
      expect(firstStackOfRole(state.layout(), 'document')).toBeNull();
    });

    it('toolFillingTheCentre_draggedBackOverTheMainWindow_comesBackAsATool', async () => {
      toolFillsTheCentre();
      popout.popOut('agent');
      await flush();

      windowDrop(0)(tool('agent'), drop(-1, 5, window.screenX + 1, window.screenY + 1));
      await flush();

      expect(stackOf('agent')).toMatchObject({ role: 'tool', primary: true, panels: ['agent'] });
      expect(firstStackOfRole(state.layout(), 'document')).toBeNull();
    });

    it('toolFillingTheCentre_movedToAnotherWindowThenClosed_comesBackAsATool', async () => {
      toolFillsTheCentre();
      popout.popOut('agent');
      popout.popOut('logs');
      await flush();
      opened(1).over = true;
      windowDrop(0)(tool('agent'), drop(-1, 5, 500, 300));
      await flush();

      opened(1).close();

      expect(stackOf('agent')).toMatchObject({ role: 'tool', primary: true, panels: ['agent'] });
      expect(stackOf('logs')?.role).toBe('tool');
    });

    it('toolFillingTheCentre_documentOpenedMeanwhile_docksBesideItAsATool', async () => {
      toolFillsTheCentre();
      popout.popOut('agent');
      await flush();
      const well: StackNode | null = findPrimaryStack(state.layout());
      state.tabInto(well?.id ?? '', 'readme');

      opened(0).close();

      expect(stackOf('agent')?.role).toBe('tool');
      expect(stackOf('agent')?.panels).toEqual(['agent']);
      expect(stackOf('readme')).toMatchObject({ role: 'document', panels: ['readme'] });
    });

    it('toolInAGroup_windowClosed_staysATool', async () => {
      toolFillsTheCentre();
      popout.popOut('logs');
      await flush();

      opened(0).close();

      expect(stackOf('logs')).toMatchObject({ role: 'tool', panels: ['errors', 'logs'] });
    });

    it('document_windowClosed_comesBackToTheWell', async () => {
      documentsInTheCentre(['readme', 'notes']);
      popout.popOut('notes');
      await flush();

      opened(0).close();

      expect(stackOf('notes')).toMatchObject({ role: 'document', panels: ['readme', 'notes'] });
    });

    it('lastDocument_windowClosed_comesBackToTheWell', async () => {
      documentsInTheCentre(['readme']);
      popout.popOut('readme');
      await flush();

      opened(0).close();

      expect(stackOf('readme')).toMatchObject({ role: 'document', primary: true });
    });

    it('lastDocument_toolTookTheCentreMeanwhile_comesBackAsADocument', async () => {
      documentsInTheCentre(['readme']);
      popout.popOut('readme');
      await flush();
      const well: StackNode | null = findPrimaryStack(state.layout());
      state.removeFromLayout('files');
      state.occupyWell(well?.id ?? '', 'files');

      opened(0).close();

      expect(stackOf('readme')).toMatchObject({ role: 'document', panels: ['readme'] });
      expect(stackOf('files')?.role).toBe('tool');
    });
  });

  describe('a layout replacing the dock', () => {
    it('returnAll_closesEveryWindowWithoutRestoring', async () => {
      popout.popOut('search');
      popout.popOut('errors');
      await flush();

      popout.returnAll();

      expect(opened(0).closeCount).toBe(1);
      expect(opened(1).closeCount).toBe(1);
      expect(popped.isPopped('search')).toBe(false);
      expect(collectPanelIds(state.layout())).not.toContain('search');
    });

    it('returnAll_withNothingOpen_doesNothing', () => {
      expect((): void => popout.returnAll()).not.toThrow();
    });

    it('returnAll_thenPopOutAgain_opensAFreshWindow', async () => {
      popout.popOut('search');
      await flush();
      popout.returnAll();

      popout.popOut('errors');
      await flush();

      expect(windows.opened).toHaveLength(2);
      expect(popped.isPopped('errors')).toBe(true);
    });
  });

  describe('tearing down', () => {
    it('destroy_closesTheWindowsWithoutTouchingTheDyingDock', async () => {
      popout.popOut('search');
      await flush();

      popout.ngOnDestroy();

      expect(opened(0).closeCount).toBe(1);
      expect(collectPanelIds(state.layout())).not.toContain('search');
    });

    it('destroy_takesTheHandlersAway', () => {
      popout.ngOnDestroy();
      popped.popOut('search');

      expect(windows.opened).toEqual([]);
    });
  });
});
