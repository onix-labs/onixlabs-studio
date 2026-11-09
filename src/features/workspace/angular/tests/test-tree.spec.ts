import { describe, expect, it } from 'vitest';
import type { TestNode } from '@shared/api/test-adapter-protocol';
import {
  entryAt,
  formatDuration,
  indexTree,
  layoutRows,
  mergeFound,
  nodeOfResult,
  rollUp,
  TestEntry,
  testKey,
  TestRow,
  TestState,
  totals,
} from './test-tree';

/**
 * A small .NET-shaped tree: a project, a class, two tests and a theory.
 */
const TREE: readonly TestNode[] = [
  {
    id: 'project',
    label: 'Shop.Tests',
    kind: 'project',
    framework: 'xUnit',
    children: [
      {
        id: 'Shop.CartTests',
        label: 'Shop.CartTests',
        kind: 'suite',
        location: { file: '/repo/CartTests.cs', line: 5 },
        children: [
          {
            id: 'Shop.CartTests.Adds',
            label: 'Adds',
            kind: 'test',
            location: { file: '/repo/CartTests.cs', line: 8 },
          },
          {
            id: 'Shop.CartTests.Fails',
            label: 'Fails',
            kind: 'test',
            location: { file: '/repo/CartTests.cs', line: 14 },
          },
          {
            id: 'Shop.CartTests.Theory',
            label: 'Theory',
            kind: 'test',
            location: { file: '/repo/CartTests.cs', line: 20 },
          },
        ],
      },
    ],
  },
];

/**
 * Indexes {@link TREE} under one plugin.
 * @param roots The roots to index.
 * @returns Returns the index.
 */
function index(roots: readonly TestNode[] = TREE): Map<string, TestEntry> {
  const into: Map<string, TestEntry> = new Map<string, TestEntry>();
  indexTree('dotnet', roots, into);
  return into;
}

/**
 * Builds a key under the test plugin.
 * @param id The node identifier.
 * @returns Returns the key.
 */
function key(id: string): string {
  return testKey('dotnet', id);
}

describe('test tree (#1352)', () => {
  it('indexTree_keepsTreeOrder_inheritsTheFramework_andListsEachNodesTests', () => {
    const entries: readonly TestEntry[] = [...index().values()];

    expect(entries.map((entry: TestEntry) => entry.node.id)).toEqual([
      'project',
      'Shop.CartTests',
      'Shop.CartTests.Adds',
      'Shop.CartTests.Fails',
      'Shop.CartTests.Theory',
    ]);
    expect(entries[2].framework).toBe('xUnit');
    expect(entries[0].tests).toEqual([
      key('Shop.CartTests.Adds'),
      key('Shop.CartTests.Fails'),
      key('Shop.CartTests.Theory'),
    ]);
    expect(entries[2].parentKey).toBe(key('Shop.CartTests'));
  });

  it('mergeFound_addsARunsCasesUnderTheirParent_once', () => {
    const cases: TestNode[] = [
      nodeOfResult({
        id: 'Shop.CartTests.Theory#(2)',
        outcome: 'passed',
        parentId: 'Shop.CartTests.Theory',
        label: 'Theory(2)',
      }),
      nodeOfResult({ id: 'Shop.CartTests.Adds', outcome: 'passed', parentId: 'Shop.CartTests' }),
    ];

    const merged: readonly TestNode[] = mergeFound(
      TREE,
      new Map([
        ['Shop.CartTests.Theory', cases.slice(0, 1)],
        ['Shop.CartTests', cases.slice(1)],
      ]),
    );

    const theory: TestNode | undefined = merged[0].children?.[0].children?.[2];
    expect(theory?.children).toEqual([
      { id: 'Shop.CartTests.Theory#(2)', label: 'Theory(2)', kind: 'test' },
    ]);
    // Already discovered, so not added twice.
    expect(merged[0].children?.[0].children?.length).toBe(3);
  });

  it('mergeFound_putsATestWhoseParentIsUnknownUnderTheFirstRoot', () => {
    const merged: readonly TestNode[] = mergeFound(
      TREE,
      new Map([['nowhere', [{ id: 'x', label: 'x', kind: 'test' }]]]),
    );

    expect(merged[0].children?.map((node: TestNode) => node.id)).toEqual(['Shop.CartTests', 'x']);
  });

  it.each<[string, Record<string, TestState>, string[], string[], string]>([
    ['running while any runs', { Adds: { outcome: 'passed' } }, ['Fails'], [], 'running'],
    ['waiting while any is queued', {}, [], ['Fails'], 'queued'],
    [
      'failed when any failed',
      { Adds: { outcome: 'passed' }, Fails: { outcome: 'failed' } },
      [],
      [],
      'failed',
    ],
    [
      'errored when one could not run',
      { Adds: { outcome: 'passed' }, Fails: { outcome: 'errored' } },
      [],
      [],
      'errored',
    ],
    [
      'passed when any passed and none failed',
      { Adds: { outcome: 'passed' }, Fails: { outcome: 'skipped' } },
      [],
      [],
      'passed',
    ],
    [
      'skipped when all were skipped',
      {
        Adds: { outcome: 'skipped' },
        Fails: { outcome: 'skipped' },
        Theory: { outcome: 'skipped' },
      },
      [],
      [],
      'skipped',
    ],
    ['not run when none has', {}, [], [], 'none'],
  ])(
    'rollUp_is %s',
    (
      _name: string,
      raw: Record<string, TestState>,
      running: string[],
      queued: string[],
      expected: string,
    ) => {
      const states: Map<string, TestState> = new Map<string, TestState>(
        Object.entries(raw).map(([id, state]: [string, TestState]): [string, TestState] => [
          key(`Shop.CartTests.${id}`),
          state,
        ]),
      );
      const tests: string[] = ['Adds', 'Fails', 'Theory'].map((id: string) =>
        key(`Shop.CartTests.${id}`),
      );

      expect(
        rollUp(
          tests,
          states,
          new Set(running.map((id: string) => key(`Shop.CartTests.${id}`))),
          new Set(queued.map((id: string) => key(`Shop.CartTests.${id}`))),
        ),
      ).toBe(expected);
    },
  );

  it('layoutRows_foldsAGroup_andSumsDurations', () => {
    const states: Map<string, TestState> = new Map<string, TestState>([
      [key('Shop.CartTests.Adds'), { outcome: 'passed', durationMs: 5 }],
      [key('Shop.CartTests.Fails'), { outcome: 'failed', durationMs: 7 }],
    ]);

    const open: readonly TestRow[] = layoutRows(index(), states, new Set(), new Set(), {
      collapsed: new Set(),
      failedOnly: false,
    });
    const folded: readonly TestRow[] = layoutRows(index(), states, new Set(), new Set(), {
      collapsed: new Set([key('Shop.CartTests')]),
      failedOnly: false,
    });

    expect(open.map((row: TestRow) => [row.depth, row.data.status])).toEqual([
      [0, 'failed'],
      [1, 'failed'],
      [2, 'passed'],
      [2, 'failed'],
      [2, 'none'],
    ]);
    expect(open[0].data.durationMs).toBe(12);
    expect(open[0].data.failed).toBe(1);
    expect(folded.map((row: TestRow) => row.key)).toEqual([key('project'), key('Shop.CartTests')]);
    expect(folded[1].expanded).toBe(false);
  });

  it('layoutRows_withFailedOnly_showsOnlyFailuresAndWhatHoldsThem', () => {
    const states: Map<string, TestState> = new Map<string, TestState>([
      [key('Shop.CartTests.Adds'), { outcome: 'passed' }],
      [key('Shop.CartTests.Fails'), { outcome: 'failed' }],
    ]);

    const rows: readonly TestRow[] = layoutRows(index(), states, new Set(), new Set(), {
      collapsed: new Set(),
      failedOnly: true,
    });

    expect(rows.map((row: TestRow) => row.data.entry.node.id)).toEqual([
      'project',
      'Shop.CartTests',
      'Shop.CartTests.Fails',
    ]);
  });

  it('totals_countsTestsByOutcome', () => {
    const states: Map<string, TestState> = new Map<string, TestState>([
      [key('Shop.CartTests.Adds'), { outcome: 'passed' }],
      [key('Shop.CartTests.Fails'), { outcome: 'errored' }],
    ]);

    expect(totals(index(), states)).toEqual({
      tests: 3,
      passed: 1,
      failed: 1,
      skipped: 0,
      notRun: 1,
    });
  });

  it.each<[number, string | undefined]>([
    [8, 'Shop.CartTests.Adds'],
    [7, 'Shop.CartTests.Adds'],
    [5, 'Shop.CartTests'],
    [17, 'Shop.CartTests.Fails'],
    [30, undefined],
  ])('entryAt_line %s_finds %s', (line: number, expected: string | undefined) => {
    expect(entryAt(index(), '/repo/CartTests.cs', line)?.node.id).toBe(expected);
  });

  it('entryAt_ignoresOtherFiles', () => {
    expect(entryAt(index(), '/repo/Other.cs', 8)).toBeUndefined();
  });

  it.each<[number | undefined, string]>([
    [undefined, ''],
    [12.4, '12 ms'],
    [1430, '1.4 s'],
    [125_000, '2 min 5 s'],
  ])('formatDuration(%s) is %s', (ms: number | undefined, expected: string) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});
