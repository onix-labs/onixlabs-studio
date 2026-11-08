import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestRunResults } from '../../protocol/testing/protocol';
import {
  readJestReport,
  readPlaywrightReport,
  readRunReports,
  splitFailure,
  wasAskedFor,
} from './reports';

// The reports below are trimmed from what Vitest 3.2.7, Jest 30.5.2 and Playwright 1.65.0 wrote for
// the fixture this plugin was verified against; only the paths are shortened.

/**
 * Vitest's JSON report (Jest's shape).
 */
const VITEST: unknown = {
  testResults: [
    {
      name: '/r/web/src/math.test.ts',
      status: 'failed',
      message: '',
      assertionResults: [
        {
          ancestorTitles: ['math'],
          fullName: 'math adds',
          status: 'passed',
          title: 'adds',
          duration: 1.18,
          failureMessages: [],
        },
        {
          ancestorTitles: ['math'],
          fullName: 'math fails on purpose',
          status: 'failed',
          title: 'fails on purpose',
          duration: 5.88,
          failureMessages: [
            'AssertionError: expected 2 to be 3 // Object.is equality\n    at /r/web/src/math.test.ts:10:23\n    at file:///r/web/node_modules/@vitest/runner/dist/chunk-hooks.js:155:11',
          ],
        },
        {
          ancestorTitles: ['math'],
          fullName: 'math is skipped',
          status: 'skipped',
          title: 'is skipped',
          failureMessages: [],
        },
        {
          ancestorTitles: ['math', 'nested'],
          fullName: 'math nested still adds',
          status: 'passed',
          title: 'still adds',
          duration: 0.13,
          failureMessages: [],
        },
      ],
    },
  ],
};

/**
 * Jest's JSON report, with a file that could not run.
 */
const JEST: unknown = {
  testResults: [
    {
      name: '/r/api/__tests__/math.test.js',
      assertionResults: [
        {
          ancestorTitles: ['math'],
          duration: null,
          fullName: 'math is skipped',
          status: 'pending',
          title: 'is skipped',
          failureMessages: [],
          location: null,
        },
        {
          ancestorTitles: [],
          duration: 0,
          fullName: 'top level',
          status: 'passed',
          title: 'top level',
          failureMessages: [],
          location: null,
        },
      ],
    },
    {
      name: '/r/api/__tests__/broken.test.js',
      message: '  ● Test suite failed to run\n\n    SyntaxError: Unexpected token',
      assertionResults: [],
    },
  ],
};

/**
 * Playwright's JSON report.
 */
const PLAYWRIGHT: unknown = {
  config: { rootDir: '/r/e2e/tests' },
  suites: [
    {
      title: 'math.spec.ts',
      file: 'math.spec.ts',
      specs: [
        {
          title: 'top level',
          file: 'math.spec.ts',
          line: 17,
          tests: [
            {
              results: [{ status: 'passed', duration: 5, stdout: [{ text: 'hi\n' }], stderr: [] }],
            },
          ],
        },
      ],
      suites: [
        {
          title: 'math',
          file: 'math.spec.ts',
          specs: [
            {
              title: 'fails on purpose',
              file: 'math.spec.ts',
              line: 8,
              tests: [
                {
                  results: [
                    {
                      status: 'failed',
                      duration: 3,
                      stdout: [],
                      stderr: [],
                      error: {
                        message:
                          'Error: \u001b[2mexpect(\u001b[22m\u001b[31mreceived\u001b[39m\u001b[2m).\u001b[22mtoBe',
                        stack:
                          'Error: \u001b[2mexpect(\u001b[22m\u001b[31mreceived\u001b[39m\u001b[2m).\u001b[22mtoBe\n    at /r/e2e/tests/math.spec.ts:9:19',
                      },
                    },
                  ],
                },
              ],
            },
            {
              title: 'is skipped',
              file: 'math.spec.ts',
              line: 12,
              tests: [{ results: [{ status: 'skipped', duration: 0, stdout: [], stderr: [] }] }],
            },
          ],
        },
      ],
    },
  ],
  errors: [],
};

describe('JavaScript report readers (#1354)', () => {
  it('splitFailure_separatesTheMessageFromTheStack_linkingFrames', () => {
    expect(
      splitFailure(
        'Error: no\nExpected: 3\n    at x (/r/a.test.ts:4:2)\n    at node:internal/x:1:1',
        '/r',
      ),
    ).toEqual({
      message: 'Error: no\nExpected: 3',
      stack: [
        { text: 'at x (/r/a.test.ts:4:2)', location: { file: '/r/a.test.ts', line: 4 } },
        { text: 'at node:internal/x:1:1' },
      ],
    });
  });

  it('readJestReport_readsVitest_namingEachTestAsDiscoveryDoes', () => {
    const { results, problems } = readJestReport(VITEST);

    expect(problems).toEqual([]);
    expect(results.map((result) => [result.id, result.outcome, result.durationMs])).toEqual([
      ['/r/web/src/math.test.ts::math > adds', 'passed', 1],
      ['/r/web/src/math.test.ts::math > fails on purpose', 'failed', 6],
      ['/r/web/src/math.test.ts::math > is skipped', 'skipped', undefined],
      ['/r/web/src/math.test.ts::math > nested > still adds', 'passed', 0],
    ]);
    expect(results[1]).toMatchObject({
      message: 'AssertionError: expected 2 to be 3 // Object.is equality',
      parentId: 'file:/r/web/src/math.test.ts',
      label: 'fails on purpose',
    });
    expect(results[1].stack?.[0]).toEqual({
      text: 'at /r/web/src/math.test.ts:10:23',
      location: { file: '/r/web/src/math.test.ts', line: 10 },
    });
  });

  it('readJestReport_readsJest_andSaysWhichFileCouldNotRun', () => {
    const { results, problems } = readJestReport(JEST);

    expect(results.map((result) => [result.id, result.outcome])).toEqual([
      ['/r/api/__tests__/math.test.js::math > is skipped', 'skipped'],
      ['/r/api/__tests__/math.test.js::top level', 'passed'],
    ]);
    expect(problems).toEqual([
      'broken.test.js: ● Test suite failed to run\n\n    SyntaxError: Unexpected token',
    ]);
  });

  it('readPlaywrightReport_resolvesFilesAgainstTheTestFolder_andStripsColour', () => {
    const { results } = readPlaywrightReport(PLAYWRIGHT);

    expect(results.map((result) => [result.id, result.outcome])).toEqual([
      ['/r/e2e/tests/math.spec.ts::top level', 'passed'],
      ['/r/e2e/tests/math.spec.ts::math > fails on purpose', 'failed'],
      ['/r/e2e/tests/math.spec.ts::math > is skipped', 'skipped'],
    ]);
    expect(results[0]).toMatchObject({
      output: 'hi\n',
      location: { file: '/r/e2e/tests/math.spec.ts', line: 17 },
    });
    expect(results[1]).toMatchObject({
      message: 'Error: expect(received).toBe',
      stack: [
        {
          text: 'at /r/e2e/tests/math.spec.ts:9:19',
          location: { file: '/r/e2e/tests/math.spec.ts', line: 9 },
        },
      ],
    });
  });

  it.each<[string, string, boolean]>([
    ['the test itself', '/r/a.test.ts::math > adds', true],
    ['its file', 'file:/r/a.test.ts', true],
    ['its suite', 'suite:/r/a.test.ts::math', true],
    ['a suite whose name it starts with', 'suite:/r/a.test.ts::ma', false],
    ['its package', 'package:/r', true],
    ['another file', 'file:/r/b.test.ts', false],
  ])(
    'wasAskedFor_countsATestAskedForThrough %s',
    (_name: string, asked: string, expected: boolean) => {
      expect(wasAskedFor([asked], '/r/a.test.ts::math > adds')).toBe(expected);
    },
  );

  describe('readRunReports', () => {
    let out: string = '';

    beforeAll(() => {
      out = fs.mkdtempSync(path.join(os.tmpdir(), 'js-reports-'));
      fs.writeFileSync(path.join(out, '1-vitest.json'), JSON.stringify(VITEST));
      fs.writeFileSync(path.join(out, '2-playwright.json'), JSON.stringify(PLAYWRIGHT));
      fs.writeFileSync(path.join(out, '3-jest.json'), '{ not json');
      fs.writeFileSync(path.join(out, 'stray.json'), '{}');
    });

    afterAll(() => {
      fs.rmSync(out, { recursive: true, force: true });
    });

    it('readsEveryStepsReport_droppingTestsTheRunDidNotAskFor', async () => {
      const results: TestRunResults = await readRunReports(out, 1, [
        'suite:/r/web/src/math.test.ts::math > nested',
        'file:/r/e2e/tests/math.spec.ts',
      ]);

      expect(results.results.map((result) => result.id)).toEqual([
        '/r/web/src/math.test.ts::math > nested > still adds',
        '/r/e2e/tests/math.spec.ts::top level',
        '/r/e2e/tests/math.spec.ts::math > fails on purpose',
        '/r/e2e/tests/math.spec.ts::math > is skipped',
      ]);
      expect(results.problem).toBe('The jest report could not be read.');
    });

    it('saysWhenAFailedRunWroteNoReport', async () => {
      const empty: string = fs.mkdtempSync(path.join(os.tmpdir(), 'js-reports-empty-'));

      expect(await readRunReports(empty, 127)).toEqual({
        results: [],
        problem: 'The run wrote no report. The terminal says why.',
      });
      fs.rmSync(empty, { recursive: true, force: true });
    });
  });
});
