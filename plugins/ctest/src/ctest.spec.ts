import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ManifestResult, parsePluginManifest } from '@shared/api/plugin-manifest';
import type { TestNode, TestResult, TestRunResults } from '../../protocol/testing/protocol';
import { readJUnit } from '../../protocol/testing/reports';
import {
  CTestDiscovery,
  discoverCTest,
  findBuildDirectory,
  readAddTests,
  readProjectName,
  readShowOnly,
  ShowOnly,
} from './discover';
import { ctestCommand, ctestResults, REPORT_NAME, toResults } from './run';

/**
 * The fixture project the listing and report were captured from (CMake and CTest 4.4.3).
 */
const FIXTURE: Readonly<Record<string, string>> = {
  'CMakeLists.txt': [
    'cmake_minimum_required(VERSION 3.21)',
    'project(Calc CXX)',
    '',
    'enable_testing()',
    '',
    'add_executable(adds tests/adds.cpp)',
    'add_executable(fails tests/fails.cpp)',
    'add_executable(skips tests/skips.cpp)',
    '',
    'add_test(NAME adds COMMAND adds)',
    'add_test(NAME fails COMMAND fails)',
    'add_test(',
    '  NAME skips',
    '  COMMAND skips)',
    'set_tests_properties(skips PROPERTIES SKIP_RETURN_CODE 77)',
    '',
    'add_subdirectory(lib)',
  ].join('\n'),
  'lib/CMakeLists.txt': 'add_executable(lib_math math.cpp)\nadd_test(lib.math lib_math)\n',
  'tests/fails.cpp': 'int main() { return 1; }\n',
};

describe('ctest adapter (#1359)', () => {
  let scratch: string = '';
  let project: string = '';
  let build: string = '';
  let discovery: CTestDiscovery;

  /**
   * Reads a file captured from the real fixture, pointed at this spec's copy of it.
   * @param name The file under `testdata/`.
   * @returns Returns its text.
   */
  function captured(name: string): string {
    return fs
      .readFileSync(path.resolve('plugins/ctest/src/testdata', name), 'utf8')
      .replaceAll('/repo/calc', project);
  }

  /**
   * Answers the listing ctest gave for the fixture's build directory.
   * @param directory The build directory asked about.
   * @returns Returns the listing, or null for any other directory.
   */
  const showOnly: ShowOnly = (directory: string): Promise<string | null> =>
    Promise.resolve(directory === build ? captured('show-only.json') : null);

  beforeAll(async () => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ctest-')));
    project = path.join(scratch, 'calc');
    build = path.join(project, 'build');
    for (const [file, text] of Object.entries(FIXTURE)) {
      fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
      fs.writeFileSync(path.join(project, file), text);
    }
    fs.mkdirSync(build);
    fs.writeFileSync(
      path.join(build, 'CMakeCache.txt'),
      `CMAKE_HOME_DIRECTORY:INTERNAL=${project}\n`,
    );
    fs.writeFileSync(path.join(build, 'CTestTestfile.cmake'), '');
    discovery = await discoverCTest(scratch, showOnly);
  });

  afterAll(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('pluginJson_isAValidManifestContributingOneTestAdapter', () => {
    const result: ManifestResult = parsePluginManifest(
      JSON.parse(fs.readFileSync(path.resolve('plugins/ctest/plugin.json'), 'utf8')),
    );

    expect(result.errors).toEqual([]);
    expect(result.manifest?.contributes.testAdapters?.map((adapter) => adapter.id)).toEqual([
      'onixlabs.ctest',
    ]);
  });

  describe('reading CMake', () => {
    it('readAddTests_readsBothFormsAcrossLines_andSkipsCommentsAndComputedNames', () => {
      expect(
        readAddTests(
          [
            FIXTURE['CMakeLists.txt'],
            '# add_test(NAME commented COMMAND x)',
            'add_test(NAME ${PREFIX}_x COMMAND x)',
            'ADD_TEST("quoted name" cmd)',
          ].join('\n'),
        ),
      ).toEqual([
        { name: 'adds', line: 10 },
        { name: 'fails', line: 11 },
        { name: 'skips', line: 12 },
        { name: 'quoted name', line: 20 },
      ]);
    });

    it('readProjectName_readsTheProjectCall', () => {
      expect(readProjectName(FIXTURE['CMakeLists.txt'])).toBe('Calc');
      expect(readProjectName(FIXTURE['lib/CMakeLists.txt'])).toBeNull();
    });

    it('readShowOnly_readsNamesAndWhereEachWasDeclared', () => {
      expect(readShowOnly(captured('show-only.json'))).toEqual([
        { name: 'adds', file: path.join(project, 'CMakeLists.txt'), line: 10 },
        { name: 'fails', file: path.join(project, 'CMakeLists.txt'), line: 11 },
        { name: 'skips', file: path.join(project, 'CMakeLists.txt'), line: 12 },
        { name: 'lib.math', file: path.join(project, 'lib', 'CMakeLists.txt'), line: 2 },
      ]);
      expect(readShowOnly('not json')).toBeNull();
    });

    it('findBuildDirectory_ignoresABuildOfAnotherSource', async () => {
      const other: string = path.join(scratch, 'other');
      fs.mkdirSync(path.join(other, 'build'), { recursive: true });
      fs.writeFileSync(
        path.join(other, 'build', 'CMakeCache.txt'),
        `CMAKE_HOME_DIRECTORY:INTERNAL=${project}\n`,
      );
      fs.writeFileSync(path.join(other, 'build', 'CTestTestfile.cmake'), '');

      expect(await findBuildDirectory(project)).toBe(build);
      expect(await findBuildDirectory(other)).toBeUndefined();
    });
  });

  describe('discovery', () => {
    it('discoverCTest_listsTheConfiguredBuild_projectFileTest', () => {
      const node: TestNode = discovery.nodes[0];

      expect(node).toMatchObject({
        id: 'ctest:calc',
        label: 'Calc',
        kind: 'project',
        framework: 'CTest',
      });
      expect(
        node.children?.map((file: TestNode): [string, readonly string[]] => [
          file.label,
          (file.children ?? []).map((test: TestNode): string => test.label),
        ]),
      ).toEqual([
        ['CMakeLists.txt', ['adds', 'fails', 'skips']],
        ['lib/CMakeLists.txt', ['lib.math']],
      ]);
      expect(node.children?.[1].children?.[0]).toEqual({
        id: 'ctest:calc::lib.math',
        label: 'lib.math',
        kind: 'test',
        location: { file: path.join(project, 'lib', 'CMakeLists.txt'), line: 2 },
      });
    });

    it('discoverCTest_withoutABuild_readsTheSourceAndSaysSo', async () => {
      const unconfigured: CTestDiscovery = await discoverCTest(scratch, () =>
        Promise.resolve(null),
      );
      // The build directory is still found, but its listing failed: the source is read instead.
      expect(
        unconfigured.nodes[0].children
          ?.flatMap((file: TestNode) => file.children ?? [])
          .map((test: TestNode) => test.label),
      ).toEqual(['adds', 'fails', 'skips', 'lib.math']);
    });
  });

  describe('commands', () => {
    it('ctestCommand_forEverything_writesTheReportIntoTheOutputFolder', () => {
      expect(ctestCommand(discovery, [], '/out')).toEqual({
        executable: 'ctest',
        args: [
          '--test-dir',
          build,
          '--output-on-failure',
          '--output-junit',
          path.join('/out', REPORT_NAME),
        ],
        cwd: build,
        title: 'Test Calc',
      });
    });

    it('ctestCommand_forTestsAndAFile_namesThemExactly_escapingTheirNames', () => {
      expect(
        ctestCommand(
          discovery,
          ['ctest:calc::fails', 'ctest:calc::file:lib/CMakeLists.txt'],
          '/out',
        ).args.slice(-2),
      ).toEqual(['-R', '^(fails|lib\\.math)$']);
    });

    it('ctestCommand_forTheWholeProject_isUnfiltered', () => {
      expect(ctestCommand(discovery, ['ctest:calc'], '/out').args).not.toContain('-R');
    });
  });

  describe('results from a real run', () => {
    it('toResults_readsTheReport_linkingAFailuresOutput', () => {
      const results: readonly TestResult[] = toResults(
        discovery,
        [],
        readJUnit(captured('ctest.xml')),
      );

      expect(results.map((result) => [result.id, result.outcome, result.durationMs])).toEqual([
        ['ctest:calc::adds', 'passed', 339],
        ['ctest:calc::fails', 'failed', 343],
        ['ctest:calc::skips', 'skipped', 348],
        ['ctest:calc::lib.math', 'passed', 345],
      ]);
      expect(results[1]).toMatchObject({
        message: 'Failed',
        output: 'tests/fails.cpp:4: expected 4, got 3',
        stack: [{ location: { file: path.join(project, 'tests', 'fails.cpp'), line: 4 } }],
      });
      expect(results[2].message).toBe('SKIP_RETURN_CODE=77');
    });

    it('ctestResults_withNoReport_saysWhyWithTheTranscriptsEnd', async () => {
      const empty: string = fs.mkdtempSync(path.join(scratch, 'out-'));
      const results: TestRunResults = await ctestResults(
        discovery,
        [],
        empty,
        'Test project /x\nNo tests were found!!!\n',
        8,
      );

      expect(results).toEqual({
        results: [],
        problem: 'ctest wrote no report (exit code 8).\nTest project /x\nNo tests were found!!!',
      });
    });
  });
});
