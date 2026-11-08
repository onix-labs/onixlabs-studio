import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestResult, TestRunResults } from '../../protocol/testing/protocol';
import type { TrxResult } from '../../protocol/testing/reports';
import { nameOf, readResults, toResults } from './results';

describe('.NET results (#1353)', () => {
  it.each<[string, TrxResult, { method: string; caseLabel?: string }]>([
    [
      'a plain test',
      { fullName: 'A.T.Adds', displayName: 'A.T.Adds', outcome: 'passed' },
      { method: 'A.T.Adds' },
    ],
    [
      "xUnit's theory case",
      { fullName: 'A.T.Adds', displayName: 'A.T.Adds(a: 1, b: 2)', outcome: 'passed' },
      { method: 'A.T.Adds', caseLabel: 'Adds(a: 1, b: 2)' },
    ],
    [
      "NUnit's test case",
      { fullName: 'A.T.Adds(1,2)', displayName: 'Adds(1,2)', outcome: 'passed' },
      { method: 'A.T.Adds', caseLabel: 'Adds(1,2)' },
    ],
    [
      "MSTest's data row",
      { fullName: 'A.T.Adds', displayName: 'Adds (1,2)', outcome: 'passed' },
      { method: 'A.T.Adds', caseLabel: 'Adds(1,2)' },
    ],
  ])(
    'nameOf reads %s',
    (_name: string, result: TrxResult, expected: { method: string; caseLabel?: string }) => {
      expect(nameOf(result)).toEqual(expected);
    },
  );

  it('toResults_placesCasesUnderTheirMethod_andCombinesThemIntoTheMethodsResult', () => {
    const results: readonly TestResult[] = toResults(
      [
        {
          fullName: 'A.T.Fails',
          displayName: 'A.T.Fails',
          outcome: 'failed',
          durationMs: 3,
          message: 'Expected 4',
          stackTrace: '   at A.T.Fails() in /repo/A/T.cs:line 11\n   at System.Reflection.Invoke()',
        },
        { fullName: 'A.T.Many(1)', displayName: 'Many(1)', outcome: 'passed', durationMs: 2 },
        { fullName: 'A.T.Many(2)', displayName: 'Many(2)', outcome: 'failed', durationMs: 5 },
        { fullName: 'A.T.Off', displayName: 'Off (1)', outcome: 'skipped' },
      ],
      '/repo',
    );

    expect(results).toEqual([
      {
        id: 'A.T.Fails',
        outcome: 'failed',
        durationMs: 3,
        message: 'Expected 4',
        stack: [
          {
            text: 'at A.T.Fails() in /repo/A/T.cs:line 11',
            location: { file: '/repo/A/T.cs', line: 11 },
          },
          { text: 'at System.Reflection.Invoke()' },
        ],
        parentId: 'A.T',
        label: 'Fails',
      },
      { id: 'A.T.Many', outcome: 'failed', durationMs: 7, parentId: 'A.T', label: 'Many' },
      {
        id: 'A.T.Many#Many(1)',
        outcome: 'passed',
        durationMs: 2,
        parentId: 'A.T.Many',
        label: 'Many(1)',
      },
      {
        id: 'A.T.Many#Many(2)',
        outcome: 'failed',
        durationMs: 5,
        parentId: 'A.T.Many',
        label: 'Many(2)',
      },
      { id: 'A.T.Off', outcome: 'skipped', parentId: 'A.T', label: 'Off' },
      { id: 'A.T.Off#Off(1)', outcome: 'skipped', parentId: 'A.T.Off', label: 'Off(1)' },
    ]);
  });

  describe('readResults', () => {
    let out: string = '';

    beforeAll(() => {
      out = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dotnet-results-')));
    });

    afterAll(() => {
      fs.rmSync(out, { recursive: true, force: true });
    });

    it('readsEveryReportInTheOutputFolder', async () => {
      const report: (name: string, outcome: string) => string = (
        name: string,
        outcome: string,
      ): string => `<TestRun><Results>
  <UnitTestResult testId="1" testName="${name}" outcome="${outcome}" duration="00:00:00.0010000"/>
</Results><TestDefinitions>
  <UnitTest id="1"><TestMethod className="A.T" name="${name}"/></UnitTest>
</TestDefinitions></TestRun>`;
      fs.mkdirSync(path.join(out, 'nested'), { recursive: true });
      fs.writeFileSync(path.join(out, 'one.trx'), report('Adds', 'Passed'));
      fs.writeFileSync(path.join(out, 'nested', 'two[1].trx'), report('Fails', 'Failed'));

      const results: TestRunResults = await readResults('/repo', out, 1, 'ignored');

      expect(results.problem).toBeUndefined();
      expect(
        results.results.map((result: TestResult): string => `${result.id}=${result.outcome}`),
      ).toEqual(['A.T.Fails=failed', 'A.T.Adds=passed']);
    });

    it('aBuildThatFailed_saysWhyFromTheTranscript', async () => {
      const empty: string = fs.mkdtempSync(path.join(out, 'empty-'));
      const transcript: string = `${'restore\n'.repeat(60)}Calc.cs(2,77): error CS1525: Invalid expression term ';'\n`;

      const results: TestRunResults = await readResults('/repo', empty, 1, transcript);

      expect(results.results).toEqual([]);
      expect(results.problem?.split('\n').length).toBe(40);
      expect(results.problem).toContain('error CS1525');
    });

    it('aRunStoppedBeforeItReported_saysSo', async () => {
      const results: TestRunResults = await readResults('/repo', path.join(out, 'missing'), -1, '');

      expect(results.problem).toBe('The run was stopped before it reported any results.');
    });
  });
});
