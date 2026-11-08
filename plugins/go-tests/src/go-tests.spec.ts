import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ManifestResult, parsePluginManifest } from '@shared/api/plugin-manifest';
import type { TestNode, TestResult, TestRunResults } from '../../protocol/testing/protocol';
import { goTestCommand } from './command';
import { discoverGo, GoDiscovery, readModulePath, readTestFunctions } from './discover';
import { readGoTranscript } from './transcript';

/**
 * The fixture module the transcripts were captured from (go 1.27.3).
 */
const FIXTURE: Readonly<Record<string, string>> = {
  'go.mod': 'module example.com/shop\n\ngo 1.22\n',
  'cart/cart.go': 'package cart\n',
  'cart/cart_test.go': [
    'package cart',
    '',
    'import "testing"',
    '',
    'func TestTotal(t *testing.T) {',
    '}',
    '',
    '/*',
    'func TestCommentedOut(t *testing.T) {}',
    '*/',
    'func TestTotalFails(t *testing.T) {',
    '}',
    '',
    'func Testlowercase(t *testing.T) {}',
    'func helper(t *testing.T) {}',
    'func TestSkipped(t *testing.T) {',
    '}',
    '',
    '',
    'func TestTable(t *testing.T) {',
    '}',
  ].join('\n'),
  'pricing/pricing_test.go': [
    'package pricing_test',
    '',
    'import "testing"',
    '',
    '',
    '',
    '',
    '',
    'func TestDiscount(t *testing.T) {',
    '}',
    '',
    '',
    '',
    '',
    'func TestDiscountPanics(t *testing.T) {',
    '}',
    'func FuzzDiscount(f *testing.F) {}',
    'func BenchmarkDiscount(b *testing.B) {}',
  ].join('\n'),
  'testdata/ignored_test.go': 'package x\nfunc TestNot(t *testing.T) {}\n',
};

describe('go test adapter (#1357)', () => {
  let scratch: string = '';
  let module: string = '';
  let discovery: GoDiscovery;

  /**
   * Reads a transcript captured from a real run of the fixture, pointed at this spec's copy of it.
   * @param name The file under `testdata/`.
   * @returns Returns its text.
   */
  function transcript(name: string): string {
    return fs
      .readFileSync(path.resolve('plugins/go-tests/src/testdata', name), 'utf8')
      .replaceAll('/repo/shop', module);
  }

  beforeAll(async () => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'go-tests-')));
    module = path.join(scratch, 'shop');
    for (const [file, text] of Object.entries(FIXTURE)) {
      fs.mkdirSync(path.dirname(path.join(module, file)), { recursive: true });
      fs.writeFileSync(path.join(module, file), text);
    }
    discovery = await discoverGo(scratch);
  });

  afterAll(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('pluginJson_isAValidManifestContributingOneTestAdapter', () => {
    const result: ManifestResult = parsePluginManifest(
      JSON.parse(fs.readFileSync(path.resolve('plugins/go-tests/plugin.json'), 'utf8')),
    );

    expect(result.errors).toEqual([]);
    expect(result.manifest?.contributes.testAdapters?.map((adapter) => adapter.id)).toEqual([
      'onixlabs.go-tests',
    ]);
  });

  describe('discovery', () => {
    it.each<[string, string | null]>([
      ['module example.com/shop\n', 'example.com/shop'],
      ['// x\nmodule "example.com/quoted"\n', 'example.com/quoted'],
      ['go 1.22\n', null],
    ])('readModulePath(%j) is %s', (text: string, expected: string | null) => {
      expect(readModulePath(text)).toBe(expected);
    });

    it('readTestFunctions_findsTestsAndFuzzTargets_notBenchmarksHelpersOrCommentedOnes', () => {
      expect(readTestFunctions(FIXTURE['pricing/pricing_test.go'])).toEqual([
        { name: 'TestDiscount', line: 9 },
        { name: 'TestDiscountPanics', line: 15 },
        { name: 'FuzzDiscount', line: 17 },
      ]);
      expect(readTestFunctions(FIXTURE['cart/cart_test.go']).map((found) => found.name)).toEqual([
        'TestTotal',
        'TestTotalFails',
        'TestSkipped',
        'TestTable',
      ]);
    });

    it('discoverGo_buildsModulePackageTest_skippingTestdata', () => {
      expect(discovery.nodes).toHaveLength(1);
      const project: TestNode = discovery.nodes[0];

      expect(project).toMatchObject({
        id: 'module:example.com/shop',
        kind: 'project',
        framework: 'go test',
      });
      expect(
        project.children?.map((node: TestNode): [string, string] => [node.id, node.label]),
      ).toEqual([
        ['example.com/shop/cart', 'cart'],
        ['example.com/shop/pricing', 'pricing'],
      ]);
      expect(project.children?.[0].children?.[1]).toEqual({
        id: 'example.com/shop/cart#TestTotalFails',
        label: 'TestTotalFails',
        kind: 'test',
        location: { file: path.join(module, 'cart', 'cart_test.go'), line: 11 },
      });
    });
  });

  describe('commands', () => {
    it('goTestCommand_forEverything_runsEveryPackageUncached', () => {
      expect(goTestCommand(discovery, [])).toEqual({
        executable: 'go',
        args: ['test', '-v', '-count=1', './...'],
        cwd: module,
        title: 'Test example.com/shop',
      });
    });

    it('goTestCommand_forTests_namesThemExactly_withASubtestRunningItsTest', () => {
      expect(
        goTestCommand(discovery, [
          'example.com/shop/cart#TestTotalFails',
          'example.com/shop/cart#TestTable/wrong',
        ]).args,
      ).toEqual(['test', '-v', '-count=1', '-run', '^(TestTotalFails|TestTable)$', './cart']);
    });

    it('goTestCommand_forAWholePackage_runsItUnfiltered', () => {
      expect(
        goTestCommand(discovery, ['example.com/shop/pricing', 'example.com/shop/cart#TestTotal'])
          .args,
      ).toEqual(['test', '-v', '-count=1', './pricing', './cart']);
    });

    it('goTestCommand_namingNothingItFound_refuses', () => {
      expect(() => goTestCommand(discovery, ['example.com/elsewhere#TestX'])).toThrow(
        /None of those/,
      );
    });
  });

  describe('results from a real run', () => {
    it('readGoTranscript_readsOutcomesMessagesLinksAndSubtests', () => {
      const results: TestRunResults = readGoTranscript(
        scratch,
        discovery,
        transcript('all.txt'),
        1,
      );
      const byId: Map<string, TestResult> = new Map<string, TestResult>(
        results.results.map((result: TestResult): [string, TestResult] => [result.id, result]),
      );

      expect(results.problem).toBeUndefined();
      expect(
        results.results.map((result: TestResult): [string, string] => [result.id, result.outcome]),
      ).toEqual([
        ['example.com/shop/cart#TestTotal', 'passed'],
        ['example.com/shop/cart#TestTotalFails', 'failed'],
        ['example.com/shop/cart#TestSkipped', 'skipped'],
        ['example.com/shop/cart#TestTable', 'failed'],
        ['example.com/shop/cart#TestTable/empty', 'passed'],
        ['example.com/shop/cart#TestTable/one', 'passed'],
        ['example.com/shop/cart#TestTable/wrong', 'failed'],
        ['example.com/shop/pricing#TestDiscount', 'passed'],
        ['example.com/shop/pricing#TestDiscountPanics', 'failed'],
      ]);
      expect(byId.get('example.com/shop/cart#TestTotalFails')).toMatchObject({
        message: 'Total(1, 2) = 3, want 4',
        stack: [{ location: { file: path.join(module, 'cart', 'cart_test.go'), line: 13 } }],
      });
      expect(byId.get('example.com/shop/cart#TestSkipped')?.message).toBe('not today');
      expect(byId.get('example.com/shop/cart#TestTable/wrong')).toMatchObject({
        parentId: 'example.com/shop/cart#TestTable',
        label: 'wrong',
        message: 'got 1, want 2',
      });
      const panicked: TestResult | undefined = byId.get(
        'example.com/shop/pricing#TestDiscountPanics',
      );
      expect(panicked?.message).toMatch(/^panic: runtime error: index out of range/);
      expect(
        panicked?.stack?.some(
          (frame) =>
            frame.location?.file === path.join(module, 'pricing', 'pricing_test.go') &&
            frame.location.line === 17,
        ),
      ).toBe(true);
    });

    it('readGoTranscript_ofASelectedRun_readsJustThoseTests', () => {
      expect(
        readGoTranscript(scratch, discovery, transcript('selected.txt'), 1).results.map(
          (result: TestResult): string => result.id,
        ),
      ).toEqual([
        'example.com/shop/cart#TestTotalFails',
        'example.com/shop/cart#TestTable',
        'example.com/shop/cart#TestTable/empty',
        'example.com/shop/cart#TestTable/one',
        'example.com/shop/cart#TestTable/wrong',
      ]);
    });

    it('readGoTranscript_ofAPackageThatDidNotBuild_saysWhy', () => {
      const results: TestRunResults = readGoTranscript(
        scratch,
        discovery,
        transcript('broken.txt'),
        1,
      );

      expect(results.results).toEqual([]);
      expect(results.problem).toContain('cannot use "no" (untyped string constant) as int value');
    });

    it('readGoTranscript_placesATestDiscoveryMissedUnderItsPackage', () => {
      expect(
        readGoTranscript(
          scratch,
          discovery,
          '=== RUN   ExampleTotal\n--- PASS: ExampleTotal (0.00s)\nok  \texample.com/shop/cart\t0.1s\n',
          0,
        ).results,
      ).toEqual([
        {
          id: 'example.com/shop/cart#ExampleTotal',
          outcome: 'passed',
          durationMs: 0,
          parentId: 'example.com/shop/cart',
          label: 'ExampleTotal',
        },
      ]);
    });
  });
});
