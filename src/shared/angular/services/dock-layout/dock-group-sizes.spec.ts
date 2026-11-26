import { TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { DockGroupSizes } from './dock-group-sizes';
import { DockPanelAvailability } from './dock-panel-availability';
import { DockPanelRegistry } from './dock-panel-registry';
import { DockNode, mkSplit, mkStack, SplitNode } from './dock-node';

describe('DockGroupSizes (#1567)', () => {
  let sizes: DockGroupSizes;

  /**
   * Registers a panel preferring a size.
   * @param id The panel's id.
   * @param defaultSize The size it prefers, or undefined for none.
   * @param maxSize The most it may be, or undefined for no limit.
   */
  function panel(id: string, defaultSize?: number, maxSize?: number): void {
    TestBed.inject(DockPanelRegistry).register({
      id,
      title: id,
      icon: Icon.CODE,
      role: 'tool',
      ...(defaultSize === undefined
        ? {}
        : { defaultInlineSize: defaultSize, defaultBlockSize: defaultSize }),
      ...(maxSize === undefined ? {} : { maxInlineSize: maxSize, maxBlockSize: maxSize }),
    });
  }

  /**
   * Puts a node beside a main group and reads the size it keeps.
   * @param node The node.
   * @returns Returns the size, or undefined when it takes a share.
   */
  function besideMain(node: DockNode): number | undefined {
    return sizes.sizeOf(node, mkSplit('row', [mkStack('main', ['editor']), node]))?.size;
  }

  beforeEach(() => {
    sizes = TestBed.inject(DockGroupSizes);
    panel('agent', 360, 900);
    panel('find', 320, 520);
    panel('notes');
  });

  it('besideTheMainGroup_aPanelsPreferenceIsKept', () => {
    expect(besideMain(mkStack('tool', ['agent']))).toBe(360);
  });

  it('withSeveralTabs_theLargestPreferenceIs_whicheverIsInFront', () => {
    expect(besideMain(mkStack('tool', ['find', 'agent']))).toBe(360);
    expect(besideMain(mkStack('tool', ['find', 'agent'], false, { active: 'agent' }))).toBe(360);
  });

  it('onceADividerSetIt_thatSizeIsKept_withinTheLimit', () => {
    expect(besideMain({ ...mkStack('tool', ['find']), size: 400 })).toBe(400);
    expect(besideMain({ ...mkStack('tool', ['find']), size: 4000 })).toBe(520);
  });

  it('aPanelThatPrefersNone_takesAShare', () => {
    expect(besideMain(mkStack('tool', ['notes']))).toBeUndefined();
  });

  it('aPanelThatCannotBeShown_asksForNothing', () => {
    TestBed.inject(DockPanelAvailability).set({ agent: false });

    expect(besideMain(mkStack('tool', ['agent', 'find']))).toBe(320);
  });

  it('aColumnBesideTheMainGroup_keepsItsWidestPanels_andSharesItsHeight', () => {
    const column: SplitNode = mkSplit('col', [
      mkStack('tool', ['agent']),
      mkStack('tool', ['find']),
    ]);

    expect(besideMain(column)).toBe(360);
    expect(sizes.sizeOf(column.children[0], column)).toBeNull();
  });

  it('theSideHoldingTheMainGroup_takesWhatIsLeft', () => {
    const centre: SplitNode = mkSplit('col', [
      mkStack('main', ['editor']),
      mkStack('tool', ['find']),
    ]);
    const root: SplitNode = mkSplit('row', [mkStack('tool', ['agent']), centre]);

    expect(sizes.sizeOf(centre, root)).toBeNull();
    expect(sizes.sizeOf(centre.children[0], centre)).toBeNull();
    expect(sizes.sizeOf(centre.children[1], centre)?.size).toBe(320);
  });

  it('withNoMainGroup_everythingTakesAShare', () => {
    const root: SplitNode = mkSplit('row', [
      mkStack('document', [], true),
      { ...mkStack('tool', ['agent']), size: 500 },
    ]);

    expect(sizes.sizeOf(root.children[1], root)).toBeNull();
  });

  it('aPanelPreferring_aWidthAndAHeight_hasTheOneOfTheSideItIsOn', () => {
    TestBed.inject(DockPanelRegistry).register({
      id: 'output',
      title: 'output',
      icon: Icon.CODE,
      role: 'tool',
      defaultInlineSize: 360,
      defaultBlockSize: 260,
    });
    const group: DockNode = mkStack('tool', ['output']);

    expect(besideMain(group)).toBe(360);
    expect(sizes.sizeOf(group, mkSplit('col', [mkStack('main', ['editor']), group]))?.size).toBe(
      260,
    );
  });
});
