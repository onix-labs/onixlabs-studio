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

  it('restoreLayout_reservesNodeIdentifiersPastTheRestoredTree', () => {
    const raw: unknown = {
      kind: 'stack',
      id: 'dock-8000',
      role: 'document',
      panels: [],
      active: null,
    };

    restoreLayout(raw, new Set<string>());

    expect(mkStack('tool', ['a']).id).toBe('dock-8001');
  });
});
