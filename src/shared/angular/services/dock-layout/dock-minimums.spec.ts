import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { DockMinimum, DockMinimums } from './dock-minimums';
import { mkSplit, mkStack, SplitNode, StackNode } from './dock-node';
import { DockPanelRegistry } from './dock-panel-registry';

/**
 * A panel body; the minimums never render it.
 */
@Component({ selector: 'app-probe', template: '' })
class Probe {}

describe('DockMinimums (#1064)', () => {
  let minimums: DockMinimums;
  let registry: DockPanelRegistry;

  /**
   * Registers a tool panel, with a declared minimum width when given.
   * @param id The panel id.
   * @param minInlineSize The panel's declared minimum width, in rem.
   */
  function panel(id: string, minInlineSize?: number): void {
    registry.register({
      id,
      title: id,
      icon: Icon.FILE,
      role: 'tool',
      component: Probe,
      ...(minInlineSize === undefined ? {} : { minInlineSize }),
    });
  }

  beforeEach(() => {
    minimums = TestBed.inject(DockMinimums);
    registry = TestBed.inject(DockPanelRegistry);
    // jsdom's root font size is 16px, so one rem is 16 pixels below.
    panel('files');
    panel('solution');
    panel('agent', 20);
  });

  it('aGroup_isAtLeastSixteenRem_orItsTabs_orItsTitle_whicheverIsWidest', () => {
    const group: StackNode = mkStack('tool', ['files', 'solution']);

    expect(minimums.minimumOf(group).inline).toBe(256);

    minimums.report(group.id, { tabs: 300, title: 120, chrome: 60 });
    expect(minimums.minimumOf(group)).toEqual({ inline: 300, block: 6 * 16 + 60 });

    minimums.report(group.id, { tabs: 200, title: 280, chrome: 60 });
    expect(minimums.minimumOf(group).inline).toBe(280);
  });

  it('aGroup_takesTheWidestOfItsPanelsDeclaredMinimums_notTheActiveOnes', () => {
    // Switching to the Agent tab must not make the group jump wider than it already is.
    const group: StackNode = mkStack('tool', ['files', 'agent']);

    expect(minimums.minimumOf(group).inline).toBe(20 * 16);
  });

  it('aRow_sumsItsChildrenAndSplitters_andTakesTheTallestAcross', () => {
    const left: StackNode = mkStack('tool', ['files']);
    const right: StackNode = mkStack('tool', ['agent']);
    const row: SplitNode = mkSplit('row', [left, right]);
    minimums.report(left.id, { tabs: 0, title: 0, chrome: 50 });
    minimums.report(right.id, { tabs: 0, title: 0, chrome: 70 });

    const minimum: DockMinimum = minimums.minimumOf(row);

    expect(minimum.inline).toBe(256 + 320 + 8);
    expect(minimum.block).toBe(96 + 70);
  });

  it('aColumn_takesTheWidestChild_soWideningItsNeighbourStopsAtTheBottomGroupsTabs', () => {
    const well: StackNode = mkStack('document', ['doc'], true);
    const bottom: StackNode = mkStack('tool', ['files', 'solution']);
    minimums.report(bottom.id, { tabs: 420, title: 0, chrome: 0 });

    expect(minimums.minimumOf(mkSplit('col', [well, bottom])).inline).toBe(420);
  });

  it('anAutoHiddenGroup_takesOnlyItsStrip_andAGroupNothingCanShowTakesNothing', () => {
    const collapsed: StackNode = mkStack('tool', ['agent'], false, { collapsed: true });
    const unknown: StackNode = mkStack('tool', []);

    expect(minimums.minimumOf(collapsed)).toEqual({ inline: 30, block: 30 });
    expect(minimums.minimumOf(unknown)).toEqual({ inline: 0, block: 0 });
    expect(minimums.minimumOf(mkSplit('row', [unknown, mkStack('tool', ['files'])])).inline).toBe(
      256,
    );
  });

  it('report_unchanged_writesNothing', () => {
    const group: StackNode = mkStack('tool', ['files']);
    minimums.report(group.id, { tabs: 10, title: 10, chrome: 10 });
    const before: DockMinimum = minimums.minimumOf(group);

    minimums.report(group.id, { tabs: 10, title: 10, chrome: 10 });
    minimums.forget(group.id);

    expect(before.block).toBe(106);
    expect(minimums.minimumOf(group).block).toBe(96);
  });
});
