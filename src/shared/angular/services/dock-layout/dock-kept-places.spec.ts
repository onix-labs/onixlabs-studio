import { createEnvironmentInjector, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanelPlaceholder } from '../../components/dock-layout/dock-panel-placeholder/dock-panel-placeholder';
import { DOCK_BLUEPRINT, DockBlueprint } from './dock-blueprint';
import { DockFloating } from './dock-floating';
import { DockPanel } from './dock-panel';
import { DockPanelAvailability } from './dock-panel-availability';
import { DockPanelRegistry } from './dock-panel-registry';
import { DockReveal } from './dock-reveal';
import { DockState } from './dock-state';
import { DockNode, mkSplit, mkStack, StackNode } from './dock-node';
import { collectPanelIds, findStackOfPanel, firstStackOfRole } from './dock-tree';
import { dockWindowProviders } from './dock-window-providers';

/**
 * Builds a tool panel.
 */
const tool: (id: string) => DockPanel = (id: string): DockPanel => ({
  id,
  title: id,
  icon: Icon.CODE,
  role: 'tool',
  component: DockPanelPlaceholder,
});

/**
 * Builds a dock that keeps its closed panels' places: an editor, with Agent and Find tabbed at its right
 * and a terminal beneath it, Agent open.
 * @param more Further panels, tabbed beside Find.
 * @returns Returns the blueprint.
 */
function blueprint(...more: readonly string[]): DockBlueprint {
  return {
    key: 'kept',
    createLayout: (): DockNode =>
      mkSplit('row', [
        mkSplit('col', [mkStack('main', ['editor']), mkStack('tool', ['terminal'])]),
        mkStack('tool', ['agent', 'find', ...more]),
      ]),
    panels: [
      { ...tool('editor'), role: 'main' },
      ...['agent', 'find', 'terminal', ...more].map(tool),
    ],
    startsOpen: ['agent'],
  };
}

/**
 * A dock, as a tab hosts one.
 */
interface Dock {
  readonly state: DockState;
  readonly availability: DockPanelAvailability;
  readonly floating: DockFloating;
  readonly reveal: DockReveal;
}

describe("a dock that keeps its closed panels' places (#1568)", () => {
  /**
   * Opens a dock, as opening a tab does.
   * @param own The dock's blueprint.
   * @returns Returns the dock.
   */
  function openDock(own: DockBlueprint = blueprint()): Dock {
    const injector: EnvironmentInjector = createEnvironmentInjector(
      [
        DockPanelRegistry,
        DockPanelAvailability,
        ...dockWindowProviders(),
        { provide: DOCK_BLUEPRINT, useValue: own },
      ],
      TestBed.inject(EnvironmentInjector),
    );
    const dock: Dock = {
      state: injector.get(DockState),
      availability: injector.get(DockPanelAvailability),
      floating: injector.get(DockFloating),
      reveal: injector.get(DockReveal),
    };
    TestBed.tick();
    return dock;
  }

  /**
   * Reads which of a dock's tool panels are open.
   * @param dock The dock.
   * @returns Returns their ids, in order.
   */
  function open(dock: Dock): readonly string[] {
    return collectPanelIds(dock.state.layout()).filter(
      (id: string): boolean => id !== 'editor' && dock.state.isOpen(id),
    );
  }

  /**
   * Moves a panel to the left edge, as dragging it there does.
   * @param dock The dock.
   * @param panelId The panel.
   */
  function moveToLeft(dock: Dock, panelId: string): void {
    dock.state.removeFromLayout(panelId);
    dock.state.dockEdge(panelId, 'left');
    TestBed.tick();
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('opens_withItsStartingPanels', () => {
    const dock: Dock = openDock();

    expect(open(dock)).toEqual(['agent']);
    expect(dock.availability.isAvailable('find')).toBe(false);
    expect(dock.availability.isAvailable('editor')).toBe(true);
  });

  it('closing_hidesThePanel_whereItIs', async () => {
    const dock: Dock = openDock();
    const before: DockNode = dock.state.layout();

    expect(await dock.state.requestClose('agent')).toBe(true);

    expect(open(dock)).toEqual([]);
    expect(dock.state.layout()).toBe(before);
    expect(dock.state.isReleased('agent')).toBe(false);
  });

  it('closing_whenItsGuardRefuses_leavesItOpen', async () => {
    const own: DockBlueprint = blueprint();
    const dock: Dock = openDock({
      ...own,
      panels: own.panels.map((panel: DockPanel): DockPanel =>
        panel.id === 'agent'
          ? { ...panel, confirmClose: (): Promise<boolean> => Promise.resolve(false) }
          : panel,
      ),
    });

    expect(await dock.state.requestClose('agent')).toBe(false);

    expect(open(dock)).toEqual(['agent']);
  });

  it('opening_showsItWhereItWas_inFront', async () => {
    const dock: Dock = openDock();
    moveToLeft(dock, 'find');
    dock.state.open('find');
    const group: StackNode = findStackOfPanel(dock.state.layout(), 'find')!;
    dock.state.setNodeSize(group.id, 410);
    await dock.state.requestClose('find');

    dock.state.open('find');

    expect(open(dock)).toEqual(['find', 'agent']);
    expect(findStackOfPanel(dock.state.layout(), 'find')?.id).toBe(group.id);
    expect(findStackOfPanel(dock.state.layout(), 'find')?.size).toBe(410);
  });

  it('opening_bringsItInFrontOfItsNeighbours', () => {
    const dock: Dock = openDock();

    dock.state.open('find');

    expect(findStackOfPanel(dock.state.layout(), 'find')?.active).toBe('find');
  });

  it('aPanelNeitherKnows_opensNothing', () => {
    const dock: Dock = openDock();
    const before: DockNode = dock.state.layout();

    dock.state.open('nope');

    expect(dock.state.layout()).toBe(before);
  });

  it('rearrangingOne_leavesAnotherThatIsOpenAlone_andStartsTheNext', () => {
    const first: Dock = openDock();
    const second: Dock = openDock();
    const before: DockNode = second.state.layout();

    moveToLeft(first, 'agent');
    const third: Dock = openDock();

    expect(second.state.layout()).toBe(before);
    expect(collectPanelIds(third.state.layout())).toEqual(collectPanelIds(first.state.layout()));
  });

  it('theOneLastRearranged_wins_andChoosingTabsIsNotRearranging', async () => {
    const first: Dock = openDock();
    const second: Dock = openDock();
    moveToLeft(second, 'agent');

    // None of these moves anything in the first.
    first.state.open('find');
    first.state.setActive(findStackOfPanel(first.state.layout(), 'agent')!.id, 'agent');
    await first.state.requestClose('agent');
    TestBed.tick();

    const third: Dock = openDock();
    expect(collectPanelIds(third.state.layout())[0]).toBe('agent');
  });

  it('aNewDock_opensItsStartingPanels_whateverIsOpenElsewhere', () => {
    const first: Dock = openDock();
    first.state.open('find');
    first.state.open('terminal');
    moveToLeft(first, 'find');

    expect(open(openDock())).toEqual(['agent']);
  });

  it('undo_isRemembered_asTheArrangementItPutBack', () => {
    const first: Dock = openDock();
    moveToLeft(first, 'agent');
    first.state.undo();
    first.state.undo();
    TestBed.tick();

    expect(collectPanelIds(openDock().state.layout())).toEqual([
      'editor',
      'terminal',
      'agent',
      'find',
    ]);
  });

  it('reset_returnsToItsOwnLayoutAndPanels_andStartsTheNextThere', async () => {
    const first: Dock = openDock();
    moveToLeft(first, 'agent');
    first.state.open('find');
    await first.state.requestClose('agent');

    first.state.reset();
    TestBed.tick();

    expect(open(first)).toEqual(['agent']);
    expect(collectPanelIds(openDock().state.layout())).toEqual([
      'editor',
      'terminal',
      'agent',
      'find',
    ]);
  });

  it('aPanelTheSavedArrangementHasNeverSeen_joinsItsNeighbours', () => {
    moveToLeft(openDock(), 'agent');

    const later: Dock = openDock(blueprint('outline'));

    expect(findStackOfPanel(later.state.layout(), 'outline')?.panels).toEqual(['agent', 'outline']);
    expect(open(later)).toEqual(['agent']);
  });

  it('aPanelWithNoNeighbours_goesOnTheSameSideOfTheMainGroup', () => {
    const own: DockBlueprint = blueprint();
    const without: DockBlueprint = {
      ...own,
      createLayout: (): DockNode =>
        mkSplit('row', [mkStack('main', ['editor']), mkStack('tool', ['agent', 'find'])]),
      panels: own.panels.filter((panel: DockPanel): boolean => panel.id !== 'terminal'),
    };
    moveToLeft(openDock(without), 'find');

    const later: Dock = openDock();

    // Beneath the editor, between the side groups, as its own layout has it.
    const terminal: StackNode = findStackOfPanel(later.state.layout(), 'terminal')!;
    const root: DockNode = later.state.layout();
    const centre: DockNode | undefined =
      root.kind === 'split'
        ? root.children.find((child: DockNode): boolean => child.kind === 'split')
        : undefined;
    expect(collectPanelIds(centre!)).toEqual(['editor', 'terminal']);
    expect(terminal.role).toBe('tool');
  });

  it('aFloatingPanel_isBroughtForward_ratherThanOpenedAgain', () => {
    const dock: Dock = openDock();
    dock.floating.float('agent', { left: 0, top: 0, width: 100, height: 100 });

    dock.reveal.open('agent');

    expect(findStackOfPanel(dock.state.layout(), 'agent')).toBeNull();
    expect(dock.floating.floats().length).toBe(1);
  });

  it('aFloatingPanelThatWasClosed_opensWhereItsOwnLayoutHasIt', async () => {
    const dock: Dock = openDock();
    dock.floating.float('agent', { left: 0, top: 0, width: 100, height: 100 });
    await dock.floating.requestClose('agent');

    dock.reveal.open('agent');

    expect(findStackOfPanel(dock.state.layout(), 'agent')?.panels).toEqual(['find', 'agent']);
  });

  it('aDockThatDoesNot_removesWhatItCloses_andSavesEveryChange', async () => {
    const own: DockBlueprint = { ...blueprint(), startsOpen: undefined };
    const dock: Dock = openDock(own);
    expect(dock.availability.isAvailable('find')).toBe(true);

    await dock.state.requestClose('agent');
    TestBed.tick();

    expect(findStackOfPanel(dock.state.layout(), 'agent')).toBeNull();
    expect(findStackOfPanel(openDock(own).state.layout(), 'agent')).toBeNull();
    expect(firstStackOfRole(dock.state.layout(), 'main')).not.toBeNull();
  });

  describe('opening a panel clear of another', () => {
    it('whenTheyShareAGroup_movesItBeneath_andShowsBoth', () => {
      const dock: Dock = openDock();

      dock.reveal.openClearOf('find', 'agent');

      const found: StackNode = findStackOfPanel(dock.state.layout(), 'find')!;
      const agent: StackNode = findStackOfPanel(dock.state.layout(), 'agent')!;
      expect(found.panels).toEqual(['find']);
      expect(agent.active).toBe('agent');
      expect(open(dock)).toEqual(['agent', 'find']);
    });

    it('whenTheyDoNot_opensItWhereItIs', () => {
      const dock: Dock = openDock();
      const before: StackNode = findStackOfPanel(dock.state.layout(), 'terminal')!;

      dock.reveal.openClearOf('terminal', 'agent');

      expect(findStackOfPanel(dock.state.layout(), 'terminal')).toEqual(before);
      expect(dock.state.isOpen('terminal')).toBe(true);
    });
  });

  describe('closing a panel wherever it is', () => {
    it('closesItInTheLayout_keepingItsPlace', () => {
      const dock: Dock = openDock();

      dock.reveal.close('agent');

      expect(dock.reveal.isOpen('agent')).toBe(false);
      dock.reveal.open('agent');
      expect(open(dock)).toEqual(['agent']);
    });

    it('closesItsFloatingWindow', async () => {
      const dock: Dock = openDock();
      dock.floating.float('agent', { left: 0, top: 0, width: 200, height: 200 });

      dock.reveal.close('agent');
      await Promise.resolve();

      expect(dock.floating.floats()).toHaveLength(0);
      expect(dock.reveal.isOpen('agent')).toBe(false);
    });

    it('doesNothingForOneThatIsNotOpen', () => {
      const dock: Dock = openDock();

      dock.reveal.close('find');

      expect(open(dock)).toEqual(['agent']);
    });
  });

  describe('toggling a panel', () => {
    it('whenItIsClosed_opensIt', () => {
      const dock: Dock = openDock();

      dock.reveal.toggle('terminal');

      expect(open(dock)).toEqual(['terminal', 'agent']);
    });

    it('whenItsGroupIsShowingIt_closesIt', () => {
      const dock: Dock = openDock();

      dock.reveal.toggle('agent');

      expect(open(dock)).toEqual([]);
    });

    it('whenItIsOpenBehindAnother_bringsItToTheFront', () => {
      const dock: Dock = openDock();
      dock.reveal.open('find');

      dock.reveal.toggle('agent');

      expect(open(dock)).toEqual(['agent', 'find']);
      expect(findStackOfPanel(dock.state.layout(), 'agent')?.active).toBe('agent');
    });

    it('whenItStandsInForTheClosedPanelInFrontOfIt_closesIt', async () => {
      const dock: Dock = openDock();
      dock.reveal.open('find');
      await dock.state.requestClose('find');

      dock.reveal.toggle('agent');

      expect(open(dock)).toEqual([]);
    });

    it('whenItIsFloating_keepsItOpen', () => {
      const dock: Dock = openDock();
      dock.floating.float('agent', { left: 0, top: 0, width: 200, height: 200 });

      dock.reveal.toggle('agent');

      expect(dock.floating.floats()).toHaveLength(1);
      expect(dock.reveal.isOpen('agent')).toBe(true);
    });

    it('whenItsGroupIsCollapsed_peeksIt_andThenClosesIt', () => {
      const dock: Dock = openDock();
      const stack: StackNode = findStackOfPanel(dock.state.layout(), 'agent')!;
      dock.state.setCollapsed(stack.id, true);

      dock.reveal.toggle('agent');
      expect(open(dock)).toEqual(['agent']);

      dock.reveal.toggle('agent');
      expect(open(dock)).toEqual([]);
    });
  });
});
