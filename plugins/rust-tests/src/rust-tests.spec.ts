import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ManifestResult, parsePluginManifest } from '@shared/api/plugin-manifest';
import type {
  TestCommand,
  TestNode,
  TestResult,
  TestRunResults,
} from '../../protocol/testing/protocol';
import { readManifest } from './cargo';
import { cargoTestCommand } from './command';
import { discoverRust, RustDiscovery } from './discover';
import { blankLiterals, isTestAttribute, RustFileScan, scanRustFile } from './rust-source';
import { readCargoTranscript, readRunningHeader } from './transcript';

/**
 * Reads a transcript captured from a real `cargo test` run of the fixture below (cargo 1.98.1).
 * @param name The file under `testdata/`.
 * @returns Returns its text.
 */
function transcript(name: string): string {
  return fs.readFileSync(path.resolve('plugins/rust-tests/src/testdata', name), 'utf8');
}

/**
 * The fixture crate the transcripts were captured from.
 */
const FIXTURE: Readonly<Record<string, string>> = {
  'Cargo.toml': '[package]\nname = "mathy"\nversion = "0.1.0"\nedition = "2021"\n',
  'src/lib.rs': [
    'pub mod geometry;',
    'pub fn add(a: i32, b: i32) -> i32 { a + b }',
    '#[cfg(test)]',
    'mod tests {',
    '    use super::*;',
    '    #[test]',
    '    fn adds() { assert_eq!(add(1, 2), 3); }',
    '    #[test]',
    '    fn fails() { assert_eq!(add(1, 2), 4, "one and two"); }',
    '    #[test]',
    '    #[ignore]',
    '    fn slow() {}',
    '    mod nested {',
    '        #[test]',
    '        fn deeper() {}',
    '    }',
    '}',
  ].join('\n'),
  'src/geometry/mod.rs': 'pub mod area;\n#[test]\nfn perimeter_of_square() {}\n',
  'src/geometry/area.rs': '#[cfg(test)]\nmod tests {\n    #[test]\n    fn of_rectangle() {}\n}\n',
  'tests/integration.rs':
    '#[test]\nfn adds_from_outside() {}\n#[test]\nfn panics_from_outside() { panic!("integration broke"); }\n',
};

describe('rust test adapter (#1356)', () => {
  let scratch: string = '';
  let crate: string = '';
  let discovery: RustDiscovery;

  beforeAll(async () => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rust-tests-')));
    crate = path.join(scratch, 'mathy');
    for (const [file, text] of Object.entries(FIXTURE)) {
      fs.mkdirSync(path.dirname(path.join(crate, file)), { recursive: true });
      fs.writeFileSync(path.join(crate, file), text);
    }
    discovery = await discoverRust(scratch);
  });

  afterAll(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('pluginJson_isAValidManifestContributingOneTestAdapter', () => {
    const result: ManifestResult = parsePluginManifest(
      JSON.parse(fs.readFileSync(path.resolve('plugins/rust-tests/plugin.json'), 'utf8')),
    );

    expect(result.errors).toEqual([]);
    expect(result.manifest?.contributes.testAdapters?.map((adapter) => adapter.id)).toEqual([
      'onixlabs.rust-tests',
    ]);
  });

  describe('source scanning', () => {
    it('blankLiterals_hidesBracesAndAttributesInStringsAndComments', () => {
      const code: string = blankLiterals(
        'let s = "#[test] {"; // fn x() {\n/* #[test] /* nested */ */ let c = \'{\';',
      );

      expect(code).not.toMatch(/[{#]/);
      expect(code.length).toBe(
        'let s = "#[test] {"; // fn x() {\n/* #[test] /* nested */ */ let c = \'{\';'.length,
      );
    });

    it.each<[string, boolean]>([
      ['test', true],
      ['tokio::test', true],
      ['tokio::test(flavor = "multi_thread")', true],
      ['async_std :: test', true],
      ['cfg(test)', false],
      ['test_case(1)', false],
      ['ignore', false],
    ])('isTestAttribute(%s) is %s', (attribute: string, expected: boolean) => {
      expect(isTestAttribute(attribute)).toBe(expected);
    });

    it('scanRustFile_findsTestsInNestedModules_andFileModulesWithTheirPaths', () => {
      const scan: RustFileScan = scanRustFile(
        [
          'mod plain;',
          '#[path = "elsewhere.rs"]',
          'mod moved;',
          'mod outer {',
          '    mod inner;',
          '    #[tokio::test]',
          '    async fn waits() {}',
          '    fn helper() {}',
          '}',
          '#[test] #[ignore = "slow"] fn later() {}',
          'const S: &str = r#"#[test] fn fake() {}"#;',
        ].join('\n'),
      );

      expect(scan.fileModules).toEqual([
        { modules: [], name: 'plain' },
        { modules: [], name: 'moved', path: 'elsewhere.rs' },
        { modules: ['outer'], name: 'inner' },
      ]);
      expect(scan.tests).toEqual([
        { modules: ['outer'], name: 'waits', line: 7, ignored: false },
        { modules: [], name: 'later', line: 10, ignored: true },
      ]);
    });

    it('readManifest_readsThePackageLibraryAndWorkspace', () => {
      expect(
        readManifest(
          '[package]\nname = "my-crate" # mine\n[lib]\nname = "mine"\n[workspace]\nmembers = []\n',
        ),
      ).toEqual({ packageName: 'my-crate', libName: 'mine', workspace: true });
    });
  });

  describe('discovery', () => {
    it('discoverRust_findsEveryTestByItsLibtestPath_acrossFileModulesAndTargets', () => {
      expect([...discovery.tests.keys()].sort()).toEqual([
        'mathy::lib::geometry::area::tests::of_rectangle',
        'mathy::lib::geometry::perimeter_of_square',
        'mathy::lib::tests::adds',
        'mathy::lib::tests::fails',
        'mathy::lib::tests::nested::deeper',
        'mathy::lib::tests::slow',
        'mathy::test:integration::adds_from_outside',
        'mathy::test:integration::panics_from_outside',
      ]);
      expect(discovery.tests.get('mathy::lib::tests::slow')?.ignored).toBe(true);
    });

    it('discoverRust_buildsProjectFileSuiteTest_withLocations', () => {
      const project: TestNode = discovery.nodes[0];
      const lib: TestNode | undefined = project.children?.find(
        (node: TestNode): boolean => node.label === 'src/lib.rs',
      );

      expect(project).toMatchObject({ id: 'mathy', kind: 'project', framework: 'cargo test' });
      expect(project.children?.map((node) => node.label)).toEqual([
        'src/lib.rs',
        'src/geometry/mod.rs',
        'src/geometry/area.rs',
        'tests/integration.rs',
      ]);
      expect(lib?.children?.map((node) => [node.kind, node.label])).toEqual([
        ['suite', 'tests'],
        ['suite', 'tests::nested'],
      ]);
      expect(lib?.children?.[0].children?.[1]).toEqual({
        id: 'mathy::lib::tests::fails',
        label: 'fails',
        kind: 'test',
        location: { file: path.join(crate, 'src', 'lib.rs'), line: 9 },
      });
    });
  });

  describe('commands', () => {
    it('cargoTestCommand_forEverything_runsTheCrateUnfiltered', () => {
      const command: TestCommand = cargoTestCommand(scratch, discovery, []);

      expect(command).toEqual({
        executable: 'cargo',
        args: ['test', '--manifest-path', path.join(crate, 'Cargo.toml'), '--no-fail-fast'],
        cwd: crate,
        title: 'Test mathy',
      });
    });

    it('cargoTestCommand_forTestsInOneTarget_narrowsToItAndPassesExactNames', () => {
      expect(
        cargoTestCommand(scratch, discovery, [
          'mathy::lib::tests::fails',
          'mathy::lib::tests::slow',
        ]).args,
      ).toEqual([
        'test',
        '--manifest-path',
        path.join(crate, 'Cargo.toml'),
        '--no-fail-fast',
        '--lib',
        '--',
        '--exact',
        '--include-ignored',
        'tests::fails',
        'tests::slow',
      ]);
    });

    it('cargoTestCommand_forAModuleAcrossNoTarget_expandsItToItsTests', () => {
      expect(
        cargoTestCommand(scratch, discovery, ['mathy::lib::mod:tests::nested']).args.slice(-3),
      ).toEqual(['--', '--exact', 'tests::nested::deeper']);
    });

    it('cargoTestCommand_forAModuleHoldingAnIgnoredTest_leavesItIgnored', () => {
      const args: readonly string[] = cargoTestCommand(scratch, discovery, [
        'mathy::lib::mod:tests',
      ]).args;

      expect(args).not.toContain('--include-ignored');
      expect(args.slice(-2)).toEqual(['tests::adds', 'tests::fails']);
    });

    it('cargoTestCommand_spanningTargets_dropsTheTargetFlag', () => {
      const args: readonly string[] = cargoTestCommand(scratch, discovery, [
        'mathy::lib::tests::adds',
        'mathy::test:integration::file:tests/integration.rs',
      ]).args;

      expect(args).not.toContain('--lib');
      expect(args).not.toContain('--test');
      expect(args.slice(-4)).toEqual([
        '--exact',
        'tests::adds',
        'adds_from_outside',
        'panics_from_outside',
      ]);
    });

    it('cargoTestCommand_namingNothingItFound_refuses', () => {
      expect(() => cargoTestCommand(scratch, discovery, ['nope'])).toThrow(/None of those tests/);
    });
  });

  describe('results from a real run', () => {
    it('readCargoTranscript_readsEveryOutcome_withPanicsLinkedIntoTheCrate', () => {
      const results: TestRunResults = readCargoTranscript(
        scratch,
        discovery,
        [],
        transcript('all.txt'),
        101,
      );
      const byId: Map<string, TestResult> = new Map<string, TestResult>(
        results.results.map((result: TestResult): [string, TestResult] => [result.id, result]),
      );

      expect(results.problem).toBeUndefined();
      expect(results.results.map((result) => [result.id, result.outcome]).sort()).toEqual([
        ['mathy::lib::geometry::area::tests::of_rectangle', 'passed'],
        ['mathy::lib::geometry::perimeter_of_square', 'passed'],
        ['mathy::lib::tests::adds', 'passed'],
        ['mathy::lib::tests::fails', 'failed'],
        ['mathy::lib::tests::nested::deeper', 'passed'],
        ['mathy::lib::tests::slow', 'skipped'],
        ['mathy::test:integration::adds_from_outside', 'passed'],
        ['mathy::test:integration::panics_from_outside', 'failed'],
      ]);
      expect(byId.get('mathy::lib::tests::fails')).toMatchObject({
        message: 'assertion `left == right` failed: one and two\n  left: 3\n right: 4',
        stack: [{ location: { file: path.join(crate, 'src', 'lib.rs'), line: 18 } }],
      });
      expect(byId.get('mathy::test:integration::panics_from_outside')).toMatchObject({
        message: 'integration broke',
        stack: [{ location: { file: path.join(crate, 'tests', 'integration.rs'), line: 8 } }],
      });
    });

    it('readCargoTranscript_ofASelectedRun_readsJustThoseTests', () => {
      const results: TestRunResults = readCargoTranscript(
        scratch,
        discovery,
        ['mathy::lib::tests::fails', 'mathy::lib::tests::slow'],
        transcript('selected.txt'),
        101,
      );

      expect(results.results.map((result) => [result.id, result.outcome])).toEqual([
        ['mathy::lib::tests::slow', 'passed'],
        ['mathy::lib::tests::fails', 'failed'],
      ]);
    });

    it('readCargoTranscript_ofABuildThatBroke_saysWhy', () => {
      expect(readCargoTranscript(scratch, discovery, [], transcript('broken.txt'), 101)).toEqual({
        results: [],
        problem:
          'The tests did not build:\nerror[E0308]: mismatched types\nerror: could not compile `mathy` (lib test) due to 1 previous error',
      });
    });

    it('readCargoTranscript_placesATestDiscoveryMissedUnderItsCrate_andKeepsLastRedraws', () => {
      const results: TestRunResults = readCargoTranscript(
        scratch,
        discovery,
        [],
        '     Running unittests src/lib.rs (target/debug/deps/mathy-0123456789abcdef)\nBuilding [=>  ]\rtest generated::case_1 ... ok\n',
        0,
      );

      expect(results.results).toEqual([
        {
          id: 'mathy::lib::generated::case_1',
          outcome: 'passed',
          parentId: 'mathy',
          label: 'generated::case_1',
        },
      ]);
    });

    it.each<[string, unknown]>([
      [
        '     Running unittests src/lib.rs (target/debug/deps/mathy-63c9d37f95b5708b)',
        { target: { kind: 'lib' }, binary: 'mathy' },
      ],
      [
        '     Running unittests src/main.rs (target/debug/deps/my_app-63c9d37f95b5708b)',
        { target: { kind: 'bin', name: 'my_app' }, binary: 'my_app' },
      ],
      [
        '     Running unittests src/bin/tool.rs (target/debug/deps/tool-63c9d37f95b5708b)',
        { target: { kind: 'bin', name: 'tool' }, binary: 'tool' },
      ],
      [
        '     Running tests/api/main.rs (target/debug/deps/api-63c9d37f95b5708b)',
        { target: { kind: 'test', name: 'api' }, binary: 'api' },
      ],
      ['test result: ok.', null],
    ])('readRunningHeader(%s)', (line: string, expected: unknown) => {
      expect(readRunningHeader(line)).toEqual(expected);
    });
  });
});
