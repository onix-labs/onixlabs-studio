import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TestDiscovery, TestNode, TestRunResults } from '@shared/api/test-adapter-protocol';
import {
  checkDiscovery,
  checkLocation,
  checkResults,
  cutTranscript,
  MAX_RUN_TRANSCRIPT_LENGTH,
  MAX_TEST_DEPTH,
  MAX_TEST_NODES,
} from './test-adapter-checks';

/**
 * The folder every check is made against.
 */
const ROOT: string = path.resolve('/studio-tests-checks/repo');

describe('test-adapter checks (#1351)', () => {
  it.each<[string, unknown]>([
    ['a relative file', { file: 'A.cs', line: 1 }],
    ['a file outside the folder', { file: path.resolve('/etc/hosts'), line: 1 }],
    ['a file that climbs out', { file: path.join(ROOT, '..', 'other', 'A.cs'), line: 1 }],
    ['a line of zero', { file: path.join(ROOT, 'A.cs'), line: 0 }],
    ['a fractional line', { file: path.join(ROOT, 'A.cs'), line: 1.5 }],
    ['nothing', null],
  ])('checkLocation_drops %s', (_name: string, location: unknown) => {
    expect(checkLocation(location, ROOT)).toBeUndefined();
  });

  it('checkLocation_keepsALinkInsideTheFolder_resolved', () => {
    expect(checkLocation({ file: path.join(ROOT, 'src', '..', 'A.cs'), line: 3 }, ROOT)).toEqual({
      file: path.join(ROOT, 'A.cs'),
      line: 3,
    });
  });

  it('checkDiscovery_stopsAtTheNodeBudget', () => {
    const tests: TestNode[] = Array.from(
      { length: MAX_TEST_NODES + 10 },
      (_: unknown, index: number): TestNode => ({ id: `t${index}`, label: 'x', kind: 'test' }),
    );

    const discovery: TestDiscovery | null = checkDiscovery({ tests }, ROOT);

    expect(discovery?.tests.length).toBe(MAX_TEST_NODES);
  });

  it('checkDiscovery_dropsWhatNestsTooDeep', () => {
    let node: TestNode = { id: 'leaf', label: 'leaf', kind: 'test' };
    for (let depth: number = 0; depth < MAX_TEST_DEPTH + 2; depth += 1) {
      node = { id: `s${depth}`, label: 's', kind: 'suite', children: [node] };
    }

    const discovery: TestDiscovery | null = checkDiscovery({ tests: [node] }, ROOT);
    let deepest: number = 0;
    let cursor: TestNode | undefined = discovery?.tests[0];
    while (cursor !== undefined) {
      deepest += 1;
      cursor = cursor.children?.[0];
    }

    expect(deepest).toBe(MAX_TEST_DEPTH + 1);
  });

  it('checkResults_keepsKnownOutcomes_dropsTheRest_andCarriesARunsProblem', () => {
    const results: TestRunResults | null = checkResults(
      {
        results: [
          { id: 'a', outcome: 'passed', durationMs: -1 },
          { id: 'b', outcome: 'skipped', message: 'not today', parentId: 'p', label: 'b (1)' },
          { id: '', outcome: 'passed' },
          { id: 'c', outcome: 'maybe' },
        ],
        problem: 'The build failed.',
      },
      ROOT,
    );

    expect(results).toEqual({
      results: [
        { id: 'a', outcome: 'passed' },
        { id: 'b', outcome: 'skipped', message: 'not today', parentId: 'p', label: 'b (1)' },
      ],
      problem: 'The build failed.',
    });
  });

  it('checkResults_keepsFramesButNotTheirLinksOutsideTheFolder', () => {
    const results: TestRunResults | null = checkResults(
      {
        results: [
          {
            id: 'a',
            outcome: 'failed',
            stack: [
              {
                text: 'at Xunit.Assert.Equal()',
                location: { file: '/usr/share/xunit/Assert.cs', line: 9 },
              },
              { nope: true },
            ],
          },
        ],
      },
      ROOT,
    );

    expect(results?.results[0].stack).toEqual([{ text: 'at Xunit.Assert.Equal()' }]);
  });

  it('cutTranscript_stripsColourAndKeepsTheEnd', () => {
    const long: string = `${'x'.repeat(MAX_RUN_TRANSCRIPT_LENGTH)}\x1b[1;31mTOTAL\x1b[0m\x1b]0;title\x07`;

    const cut: string = cutTranscript(long);

    expect(cut.length).toBe(MAX_RUN_TRANSCRIPT_LENGTH);
    expect(cut.endsWith('TOTAL')).toBe(true);
    expect(cutTranscript(42)).toBe('');
  });
});
