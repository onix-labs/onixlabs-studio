import { DockNode, mkStack, SplitNode, StackNode } from './dock-node';
import { restoreLayout } from './dock-persistence';

describe('dock-persistence', () => {
  it('restoreLayout_rejectsNonNodesAndMalformedInput', () => {
    const known: ReadonlySet<string> = new Set(['explorer']);

    expect(restoreLayout(null, known)).toBeNull();
    expect(restoreLayout(42, known)).toBeNull();
    expect(restoreLayout({ kind: 'bogus' }, known)).toBeNull();
    expect(
      restoreLayout({ kind: 'split', id: 'dock-1', dir: 'row', children: [], sizes: [] }, known),
    ).toBeNull();
  });

  it('restoreLayout_stripsUnknownPanelsButKeepsTheDocumentWell', () => {
    const raw: unknown = {
      kind: 'split',
      id: 'dock-1',
      dir: 'row',
      children: [
        {
          kind: 'stack',
          id: 'dock-2',
          role: 'tool',
          panels: ['explorer', 'stale'],
          active: 'stale',
        },
        {
          kind: 'stack',
          id: 'dock-3',
          role: 'document',
          panels: ['/a.ts', '/b.ts'],
          active: '/a.ts',
        },
      ],
      sizes: [1, 3],
    };

    const result: SplitNode = restoreLayout(raw, new Set(['explorer'])) as SplitNode;

    expect(result.kind).toBe('split');
    const tool: StackNode = result.children[0] as StackNode;
    expect(tool.panels).toEqual(['explorer']);
    expect(tool.active).toBe('explorer');
    const well: StackNode = result.children[1] as StackNode;
    expect(well.role).toBe('document');
    expect(well.panels).toEqual([]);
    expect(well.active).toBeNull();
  });

  it('restoreLayout_dropsEmptiedToolStacksAndPromotesTheSurvivingChild', () => {
    const raw: unknown = {
      kind: 'split',
      id: 'dock-1',
      dir: 'row',
      children: [
        { kind: 'stack', id: 'dock-2', role: 'tool', panels: ['stale'], active: 'stale' },
        { kind: 'stack', id: 'dock-3', role: 'document', panels: [], active: null },
      ],
      sizes: [1, 3],
    };

    const result: DockNode | null = restoreLayout(raw, new Set<string>());

    expect(result?.kind).toBe('stack');
    expect((result as StackNode).role).toBe('document');
  });

  it('restoreLayout_returnsNullWhenNoDocumentWellSurvives', () => {
    const raw: unknown = {
      kind: 'stack',
      id: 'dock-1',
      role: 'tool',
      panels: ['explorer'],
      active: 'explorer',
    };

    expect(restoreLayout(raw, new Set(['explorer']))).toBeNull();
  });

  it('restoreLayout_keepsAToolOccupiedPrimaryCentreEvenWithNoDocumentWell', () => {
    // The agent occupying the centre: a primary tool stack, no document well. It must restore (the
    // slot reverts to a well when emptied) rather than reset the whole layout, and the primary flag
    // must round-trip.
    const raw: unknown = {
      kind: 'split',
      id: 'dock-1',
      dir: 'row',
      children: [
        { kind: 'stack', id: 'dock-2', role: 'tool', panels: ['files'], active: 'files' },
        {
          kind: 'stack',
          id: 'dock-3',
          role: 'tool',
          panels: ['agent'],
          active: 'agent',
          primary: true,
        },
      ],
      sizes: [1, 3],
    };

    const result: SplitNode = restoreLayout(raw, new Set(['files', 'agent'])) as SplitNode;

    expect(result).not.toBeNull();
    const centre: StackNode = result.children[1] as StackNode;
    expect(centre.role).toBe('tool');
    expect(centre.panels).toEqual(['agent']);
    expect(centre.primary).toBe(true);
  });

  it('restoreLayout_roundTripsACollapsedStacksRememberedEdge', () => {
    const raw: unknown = {
      kind: 'split',
      id: 'dock-1',
      dir: 'row',
      children: [
        { kind: 'stack', id: 'dock-2', role: 'document', panels: [], active: null, primary: true },
        {
          kind: 'stack',
          id: 'dock-3',
          role: 'tool',
          panels: ['agent'],
          active: 'agent',
          collapsed: true,
          side: 'right',
        },
      ],
      sizes: [4, 1],
    };

    const result: SplitNode = restoreLayout(raw, new Set(['agent'])) as SplitNode;

    const gutter: StackNode = result.children[1] as StackNode;
    expect(gutter.collapsed).toBe(true);
    expect(gutter.side).toBe('right');
  });

  it('restoreLayout_rejectsAnInvalidRememberedEdge', () => {
    const raw: unknown = {
      kind: 'stack',
      id: 'dock-1',
      role: 'tool',
      panels: ['agent'],
      active: 'agent',
      collapsed: true,
      side: 'sideways',
    };

    expect(restoreLayout(raw, new Set(['agent']))).toBeNull();
  });

  it('restoreLayout_reservesNodeIdentifiersPastTheRestoredTree', () => {
    // The node-id sequence is process-global and other spec files sharing this worker advance it,
    // so anchor the reserved id to the live counter rather than a fixed number — an absolute
    // expectation would depend on test-file execution order.
    const current: number = Number(/^dock-(\d+)$/.exec(mkStack('tool', ['x']).id)?.[1]);
    const reserved: number = current + 500;
    const raw: unknown = {
      kind: 'stack',
      id: `dock-${reserved}`,
      role: 'document',
      panels: [],
      active: null,
    };

    restoreLayout(raw, new Set<string>());

    expect(mkStack('tool', ['a']).id).toBe(`dock-${reserved + 1}`);
  });
});
