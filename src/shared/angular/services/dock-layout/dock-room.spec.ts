import { TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { DockAutoHide } from './dock-auto-hide';
import { DOCK_BLUEPRINT, DockBlueprint } from './dock-blueprint';
import { layoutAfterDrop } from './dock-drop';
import { DockFocus } from './dock-focus';
import { DockMinimums } from './dock-minimums';
import { DockNode, DockSide, isStackNode, mkSplit, mkStack, StackNode } from './dock-node';
import { DockPanelAvailability } from './dock-panel-availability';
import { DockPanelRegistry } from './dock-panel-registry';
import { DockReveal } from './dock-reveal';
import { DockRoom } from './dock-room';
import { DockSides } from './dock-sides';
import { SIMPLE_DOCK } from './dock-simple';
import { DockState } from './dock-state';
import { findStackOfPanel, firstStackOfRole, sideOfMain } from './dock-tree';

describe('DockRoom (#1575)', () => {
  let dock: DockState;
  let room: DockRoom;
  let minimums: DockMinimums;

  /**
   * Starts a dock: files on the left and agent on the right of an editor, with output beneath it, and notes
   * beneath the agent.
   * @param startsOpen The panels open.
   * @param blueprint What else its blueprint has.
   */
  function start(
    startsOpen: readonly string[] = ['files', 'agent'],
    blueprint: Partial<DockBlueprint> = SIMPLE_DOCK,
  ): void {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DOCK_BLUEPRINT,
          useValue: {
            key: 'test-room',
            createLayout: (): DockNode =>
              mkSplit('row', [
                mkStack('tool', ['files']),
                mkSplit('col', [mkStack('main', ['editor']), mkStack('tool', ['output'])]),
                mkSplit('col', [mkStack('tool', ['agent', 'find']), mkStack('tool', ['notes'])]),
              ]),
            panels: [
              { id: 'editor', title: 'Editor', icon: Icon.CODE, role: 'main' },
              tool('files', 15, DockSides.Horizontal),
              tool('agent', 20, DockSides.Horizontal),
              tool('find', 25, DockSides.Horizontal),
              tool('notes', 16, DockSides.All),
              tool('output', 16, DockSides.Vertical),
            ],
            startsOpen,
            ...blueprint,
          } satisfies DockBlueprint,
        },
      ],
    });
    dock = TestBed.inject(DockState);
    room = TestBed.inject(DockRoom);
    minimums = TestBed.inject(DockMinimums);
    const registry: DockPanelRegistry = TestBed.inject(DockPanelRegistry);
    for (const panel of TestBed.inject(DOCK_BLUEPRINT).panels) {
      registry.register(panel);
    }
    TestBed.tick();
  }

  /**
   * Builds a tool panel.
   * @param id The panel's id.
   * @param minInlineSize Its least width, in rem, which are 16 pixels here.
   * @param sides The sides it may dock to.
   * @returns Returns the panel.
   */
  function tool(id: string, minInlineSize: number, sides: DockSides): DockBlueprint['panels'][0] {
    return { id, title: id, icon: Icon.CODE, role: 'tool', minInlineSize, minBlockSize: 5, sides };
  }

  /**
   * Gets the group of a panel.
   * @param id The panel's id.
   * @returns Returns the group.
   */
  function groupOf(id: string): StackNode {
    return findStackOfPanel(dock.layout(), id)!;
  }

  /**
   * Gets the panels whose groups are collapsed, by the first panel of each.
   * @returns Returns the panels' ids.
   */
  function collapsed(): readonly string[] {
    return ['files', 'output', 'agent', 'notes'].filter((id: string): boolean =>
      room.isCollapsed(groupOf(id)),
    );
  }

  /**
   * Gets the side of the editor a panel is on.
   * @param id The panel's id.
   * @returns Returns the side.
   */
  function sideOf(id: string): DockSide | undefined {
    return sideOfMain(dock.layout(), groupOf(id).id)?.side;
  }

  /**
   * Determines whether a panel may be dropped beside the editor, or on an edge.
   * @param id The panel's id.
   * @param side The side of the editor.
   * @returns Returns true when it may.
   */
  function admits(id: string, side: DockSide): boolean {
    return room.admits(
      layoutAfterDrop(dock.layout(), id, 'tool', {
        kind: 'split',
        stackId: firstStackOfRole(dock.layout(), 'main')!.id,
        side,
      }),
      [id],
    );
  }

  beforeEach(() => localStorage.clear());

  afterEach(() => localStorage.clear());

  // Files is 240 wide, agent 320 and dividers 8, so the two need 576 and a window of 1152.
  it('whatFits_isLeftAlone_withTheMainGroupsHalfItsLeast', () => {
    start();
    minimums.measureSpace(1152, 800);

    expect(collapsed()).toEqual([]);
    expect(minimums.minimumOf(firstStackOfRole(dock.layout(), 'main')!)).toEqual({
      inline: 576,
      block: 400,
    });
  });

  it('theLeastRecentlyUsedGroup_collapsesFirst_andTheLastToCollapseComesBackFirst', () => {
    start();
    minimums.measureSpace(1152, 800);
    const focus: DockFocus = TestBed.inject(DockFocus);
    focus.focus(groupOf('agent').id);
    TestBed.tick();
    focus.focus(groupOf('files').id);
    TestBed.tick();

    minimums.measureSpace(1150, 800);
    expect(collapsed()).toEqual(['agent']);
    minimums.measureSpace(400, 800);
    expect(collapsed()).toEqual(['files', 'agent']);

    // Using a group doesn't change what is collapsed, only what collapses next.
    focus.focus(groupOf('agent').id);
    TestBed.tick();
    // With the agent a strip, files needs 240 + 30 + 16 of its half.
    minimums.measureSpace(572, 800);
    expect(collapsed()).toEqual(['agent']);
    minimums.measureSpace(1152, 800);
    expect(collapsed()).toEqual([]);
  });

  it('resizingBackAndForth_neverLeavesItUnsettled', () => {
    start();
    for (let width: number = 1200; width >= 300; width -= 7) {
      minimums.measureSpace(width, 800);
      const first: readonly string[] = collapsed();
      expect(collapsed()).toEqual(first);
    }
    const order: number[] = [];
    for (let width: number = 300; width <= 1200; width += 7) {
      minimums.measureSpace(width, 800);
      order.push(collapsed().length);
    }
    expect(order).toEqual([...order].sort((one: number, other: number): number => other - one));
    expect(collapsed()).toEqual([]);
  });

  it('collapsingForWantOfRoom_isNotInTheLayout', () => {
    start();
    const before: DockNode = dock.layout();
    minimums.measureSpace(400, 800);

    expect(collapsed()).toEqual(['files', 'agent']);
    expect(dock.layout()).toBe(before);
    expect(localStorage.getItem('dock.layout.test-room')).toBeNull();
  });

  it('whatTheUserCollapses_staysCollapsed_howeverMuchRoomThereIs', () => {
    start();
    minimums.measureSpace(1152, 800);
    TestBed.inject(DockAutoHide).pin(groupOf('agent').id, 'right');

    minimums.measureSpace(2000, 800);

    expect(collapsed()).toEqual(['agent']);
    expect(groupOf('agent').collapsed).toBe(true);
  });

  it('aGroupTheUserCollapsed_canBeDocked_onlyWhileThereIsRoom', () => {
    start();
    minimums.measureSpace(1152, 800);
    const autoHide: DockAutoHide = TestBed.inject(DockAutoHide);
    autoHide.pin(groupOf('agent').id, 'right');

    minimums.measureSpace(1100, 800);
    expect(room.canDock(groupOf('agent').id)).toBe(false);
    minimums.measureSpace(1152, 800);
    expect(room.canDock(groupOf('agent').id)).toBe(true);

    autoHide.unpin(groupOf('agent').id);
    expect(collapsed()).toEqual([]);
  });

  it('aPanelOpenedWithNoRoom_collapsesItsOwnGroup_andSlidesOut', () => {
    start(['files']);
    minimums.measureSpace(1000, 800);

    TestBed.inject(DockReveal).open('agent');
    TestBed.tick();

    expect(collapsed()).toEqual(['agent']);
    expect(TestBed.inject(DockAutoHide).flyoutStackId()).toBe(groupOf('agent').id);
  });

  it('aPanelOpenedInAGroup_countsTowardsIt_andAClosedOneDoesNot', async () => {
    start();
    minimums.measureSpace(1152, 800);

    TestBed.inject(DockReveal).open('find');
    TestBed.tick();
    expect(collapsed()).toEqual(['agent']);

    await dock.requestClose('find');
    expect(collapsed()).toEqual([]);
  });

  it('whatSlidOut_slidesBack_onceThereIsRoomToDockIt', () => {
    start(['files']);
    minimums.measureSpace(1000, 800);
    TestBed.inject(DockReveal).open('agent');

    minimums.measureSpace(1152, 800);
    TestBed.tick();

    expect(collapsed()).toEqual([]);
    expect(TestBed.inject(DockAutoHide).flyoutStackId()).toBeNull();
  });

  it('groupsStackedInAColumnThatIsTooWide_collapseTogether_toOneStrip', () => {
    start(['agent', 'notes']);
    minimums.measureSpace(400, 800);

    expect(collapsed()).toEqual(['agent', 'notes']);
    const column: DockNode = (dock.layout() as { children: readonly DockNode[] }).children[2];
    expect(isStackNode(column)).toBe(false);
    expect(room.isStrip(column)).toBe(true);
    expect(minimums.minimumOf(column, (): boolean => true).inline).toBe(30);
  });

  it('aDockTooShort_collapsesWhatIsBeneath', () => {
    start(['files', 'output']);
    minimums.measureSpace(1152, 160);

    expect(collapsed()).toEqual(['output']);
  });

  it('aDropWithNoRoom_isRefused', () => {
    start(['files', 'agent', 'notes']);
    minimums.measureSpace(1152, 800);

    // Notes from beneath the agent to beside it needs another 256 and a divider.
    expect(admits('notes', 'left')).toBe(false);
    expect(admits('notes', 'bottom')).toBe(true);
    minimums.measureSpace(1152 + 2 * (256 + 8), 800);
    expect(admits('notes', 'left')).toBe(true);
  });

  it('aDropOnASideThePanelDoesNotAllow_isRefused', () => {
    start();
    minimums.measureSpace(3000, 2000);

    expect(admits('agent', 'bottom')).toBe(false);
    expect(admits('agent', 'left')).toBe(true);
  });

  it('aGroup_allowsTheSidesAllItsPanelsDo', () => {
    start(['files', 'agent', 'notes', 'output']);
    minimums.measureSpace(3000, 2000);
    const into: (id: string, other: string) => boolean = (id: string, other: string): boolean =>
      room.admits(
        layoutAfterDrop(dock.layout(), id, 'tool', { kind: 'tab', stackId: groupOf(other).id }),
        [id],
      );

    expect(into('agent', 'files')).toBe(true);
    expect(into('agent', 'output')).toBe(false);
    expect(into('output', 'agent')).toBe(false);
    expect(into('notes', 'output')).toBe(true);
  });

  it('aPanelReopenedOnASideItDoesNotAllow_goesBackToWhereItStarts', async () => {
    start(['files', 'agent', 'notes', 'find']);
    minimums.measureSpace(3000, 2000);
    const main: string = firstStackOfRole(dock.layout(), 'main')!.id;
    dock.movePanel('find', groupOf('notes').id, 1);
    await dock.requestClose('find');
    dock.splitStackBeside(groupOf('notes').id, main, 'bottom');
    TestBed.tick();
    expect(sideOf('notes')).toBe('bottom');

    TestBed.inject(DockReveal).open('find');
    TestBed.tick();

    expect(sideOf('find')).toBe('right');
    expect(groupOf('find').id).toBe(groupOf('agent').id);
    expect(sideOf('notes')).toBe('bottom');
  });

  it('aDockThatGivesItsMainGroupNoShare_hasNoneOfThis', () => {
    start(['files', 'agent', 'notes', 'output'], { appearance: 'simple' });
    minimums.measureSpace(200, 100);

    expect(collapsed()).toEqual([]);
    expect(admits('agent', 'bottom')).toBe(true);
    expect(TestBed.inject(DockPanelAvailability).keepsPlaces).toBe(true);
  });
});
