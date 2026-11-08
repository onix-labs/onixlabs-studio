import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ManifestResult, parsePluginManifest } from '@shared/api/plugin-manifest';
import type { TestNode, TestResult, TestRunResults } from '../../protocol/testing/protocol';
import { jvmTestCommand } from './command';
import { discoverJvm, JvmDiscovery } from './discover';
import { JvmFileScan, scanJvmFile } from './jvm-source';
import { jvmResults, reportDirectory, stampStart } from './results';

/**
 * Reads a report captured from a real run of the fixture (Gradle 9.6.1, Maven 3.9.16 with Surefire
 * 3.5.2, JUnit 5.11.0, JDK 26), pointed at a spec's copy of the fixture.
 * @param name The file under `testdata/`.
 * @returns Returns its text.
 */
function report(name: string): string {
  return fs.readFileSync(path.resolve('plugins/jvm-tests/src/testdata', name), 'utf8');
}

/**
 * The Gradle fixture's test class, as the reports were captured from.
 */
const CART_TEST: string = [
  'package com.shop;',
  '',
  'import static org.junit.jupiter.api.Assertions.assertEquals;',
  '',
  'import org.junit.jupiter.api.Disabled;',
  'import org.junit.jupiter.api.DisplayName;',
  'import org.junit.jupiter.api.Nested;',
  'import org.junit.jupiter.api.Test;',
  'import org.junit.jupiter.params.ParameterizedTest;',
  'import org.junit.jupiter.params.provider.CsvSource;',
  '',
  'class CartTest {',
  '    @Test',
  '    void adds() {',
  '        assertEquals(3, 1 + 2);',
  '    }',
  '',
  '    @Test',
  '    void fails() {',
  '        assertEquals(4, 1 + 2, "one and two");',
  '    }',
  '',
  '    @Test',
  '    @Disabled("not today")',
  '    void slow() {',
  '    }',
  '',
  '    @ParameterizedTest',
  '    @CsvSource({"1, 2, 3", "2, 2, 5"})',
  '    void sums(int a, int b, int total) {',
  '        assertEquals(total, a + b);',
  '    }',
  '',
  '    // @Test void commentedOut() {}',
  '    String text = "@Test void inAString() {}";',
  '',
  '    @Nested',
  '    @DisplayName("when empty")',
  '    class Empty {',
  '        @Test',
  '        void totalIsZero() {',
  '            assertEquals(0, 0);',
  '        }',
  '    }',
  '}',
].join('\n');

/**
 * The Maven fixture's test class.
 */
const PRICING_TEST: string = [
  'package com.shop;',
  '',
  'public class PricingTest {',
  '    @Test public void discounts() {}',
  '    @Test public void rounds() {}',
  '    @Test @Disabled public void later() {}',
  '    @ParameterizedTest @ValueSource(ints = {1, 2, 3}) public void positive(int value) {}',
  '}',
].join('\n');

describe('jvm test adapter (#1358)', () => {
  let scratch: string = '';
  let gradle: string = '';
  let maven: string = '';
  let discovery: JvmDiscovery;

  /**
   * Writes a file under the scratch folder.
   * @param file The path relative to it.
   * @param text The contents.
   */
  function write(file: string, text: string): void {
    fs.mkdirSync(path.dirname(path.join(scratch, file)), { recursive: true });
    fs.writeFileSync(path.join(scratch, file), text);
  }

  beforeAll(async () => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jvm-tests-')));
    gradle = path.join(scratch, 'gradle-shop');
    maven = path.join(scratch, 'maven-pricing');
    write('gradle-shop/settings.gradle', "include 'app'\n");
    write('gradle-shop/app/build.gradle', "plugins { id 'java' }\n");
    write('gradle-shop/app/src/test/java/com/shop/CartTest.java', CART_TEST);
    write('maven-pricing/pom.xml', '<project/>\n');
    write('maven-pricing/mvnw', '#!/bin/sh\n');
    write('maven-pricing/src/test/java/com/shop/PricingTest.java', PRICING_TEST);
    discovery = await discoverJvm(scratch);
  });

  afterAll(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('pluginJson_isAValidManifestContributingOneTestAdapter', () => {
    const result: ManifestResult = parsePluginManifest(
      JSON.parse(fs.readFileSync(path.resolve('plugins/jvm-tests/plugin.json'), 'utf8')),
    );

    expect(result.errors).toEqual([]);
    expect(result.manifest?.contributes.testAdapters?.map((adapter) => adapter.id)).toEqual([
      'onixlabs.jvm-tests',
    ]);
  });

  describe('source scanning', () => {
    it('scanJvmFile_findsTestsInClassesAndNestedClasses_notInCommentsOrStrings', () => {
      const scan: JvmFileScan = scanJvmFile(CART_TEST);

      expect(scan.packageName).toBe('com.shop');
      expect(
        scan.classes.map((cls) => [
          cls.binaryName,
          cls.tests.map((test) => [test.name, test.line, test.disabled]),
        ]),
      ).toEqual([
        [
          'CartTest',
          [
            ['adds', 14, false],
            ['fails', 19, false],
            ['slow', 25, true],
            ['sums', 30, false],
          ],
        ],
        ['CartTest$Empty', [['totalIsZero', 41, false]]],
      ]);
    });

    it('scanJvmFile_readsKotlinBacktickNamesAndJUnit4', () => {
      const scan: JvmFileScan = scanJvmFile(
        [
          'package com.shop',
          'import org.junit.Test',
          'import org.junit.Ignore',
          'class PricingTest(private val rate: Int) {',
          '    @Test',
          '    fun `discount takes ten percent`() {}',
          '    @org.junit.Test @Ignore fun rounds() = Unit',
          '    fun helper() {}',
          '    val text = """@Test fun fake() {}"""',
          '}',
        ].join('\n'),
      );

      expect(scan.classes[0].tests).toEqual([
        { name: 'discount takes ten percent', line: 6, disabled: false },
        { name: 'rounds', line: 7, disabled: true },
      ]);
    });
  });

  describe('discovery', () => {
    it('discoverJvm_findsEachProject_withClassNestedClassAndTest', () => {
      const [gradleProject, mavenProject] = discovery.nodes;

      expect(
        discovery.nodes.map((node: TestNode): [string, string] => [node.id, node.framework ?? '']),
      ).toEqual([
        ['jvm:gradle-shop/app', 'JUnit (Gradle)'],
        ['jvm:maven-pricing', 'JUnit (Maven)'],
      ]);
      const cart: TestNode | undefined = gradleProject.children?.[0];
      expect(cart?.label).toBe('com.shop.CartTest');
      expect(cart?.children?.map((node: TestNode): string => node.id)).toEqual([
        'com.shop.CartTest$Empty',
        'com.shop.CartTest#adds',
        'com.shop.CartTest#fails',
        'com.shop.CartTest#slow',
        'com.shop.CartTest#sums',
      ]);
      expect(cart?.children?.[3].label).toBe('slow (disabled)');
      expect(
        mavenProject.children?.[0].children?.map((node: TestNode): string => node.label),
      ).toEqual(['discounts', 'rounds', 'later (disabled)', 'positive']);
    });
  });

  describe('commands', () => {
    it('jvmTestCommand_forAGradleSubproject_runsItsTaskFromTheSettingsRoot_rerun', () => {
      expect(jvmTestCommand(discovery, ['jvm:gradle-shop/app'])).toEqual({
        executable: 'gradle',
        args: [':app:test', '--rerun', '--continue'],
        cwd: gradle,
        title: 'Test app',
      });
    });

    it('jvmTestCommand_forGradleTests_filtersByClassAndMethod', () => {
      expect(
        jvmTestCommand(discovery, ['com.shop.CartTest$Empty', 'com.shop.CartTest#fails']).args,
      ).toEqual([
        ':app:test',
        '--rerun',
        '--tests',
        'com.shop.CartTest$Empty',
        '--tests',
        'com.shop.CartTest.fails',
        '--continue',
      ]);
    });

    it('jvmTestCommand_forMavenTests_usesTheWrapperAndDTest', () => {
      expect(
        jvmTestCommand(discovery, [
          'com.shop.PricingTest#rounds',
          'com.shop.PricingTest#positive[2]',
        ]),
      ).toEqual({
        executable: path.join(maven, 'mvnw'),
        args: [
          'test',
          '-Dtest=com.shop.PricingTest#rounds+positive',
          '-DfailIfNoTests=false',
          '-Dsurefire.failIfNoSpecifiedTests=false',
        ],
        cwd: maven,
        title: 'Test maven-pricing',
      });
    });

    it('jvmTestCommand_acrossSeparateBuilds_refuses', () => {
      expect(() => jvmTestCommand(discovery, [])).toThrow(/separate builds/);
    });
  });

  describe('results from real runs', () => {
    /**
     * Places a captured report where a project's build writes it.
     * @param project The project's folder.
     * @param tool The build tool.
     * @param name The captured file.
     * @param as The report's name.
     */
    function place(project: string, tool: 'gradle' | 'maven', name: string, as: string): string {
      const directory: string = reportDirectory({
        id: '',
        name: '',
        directory: project,
        tool,
        buildRoot: project,
      });
      fs.mkdirSync(directory, { recursive: true });
      const file: string = path.join(directory, as);
      fs.writeFileSync(
        file,
        report(name).replaceAll('/repo/gradle-shop', gradle).replaceAll('/repo/pricing', maven),
      );
      return file;
    }

    it('jvmResults_readsGradlesReports_methodsByName_displayNamesUnderTheirClass', async () => {
      const app: string = path.join(gradle, 'app');
      const out: string = fs.mkdtempSync(path.join(scratch, 'out-'));
      await stampStart(out, Date.now() - 60_000);
      place(app, 'gradle', 'gradle-TEST-com.shop.CartTest.xml', 'TEST-com.shop.CartTest.xml');
      place(
        app,
        'gradle',
        'gradle-TEST-com.shop.CartTest$Empty.xml',
        'TEST-com.shop.CartTest$Empty.xml',
      );

      const results: TestRunResults = await jvmResults(
        discovery,
        ['jvm:gradle-shop/app'],
        out,
        '',
        1,
      );
      const byId: Map<string, TestResult> = new Map<string, TestResult>(
        results.results.map((result: TestResult): [string, TestResult] => [result.id, result]),
      );

      expect(
        results.results.map((result: TestResult): [string, string] => [result.id, result.outcome]),
      ).toEqual([
        ['com.shop.CartTest$Empty#totalIsZero', 'passed'],
        ['com.shop.CartTest#adds', 'passed'],
        ['com.shop.CartTest#slow', 'skipped'],
        ['com.shop.CartTest#[1] 1, 2, 3', 'passed'],
        ['com.shop.CartTest#[2] 2, 2, 5', 'failed'],
        ['com.shop.CartTest#fails', 'failed'],
      ]);
      expect(
        byId.get('com.shop.CartTest#fails')?.stack?.find((frame) => frame.location !== undefined)
          ?.location,
      ).toEqual({
        file: path.join(app, 'src', 'test', 'java', 'com', 'shop', 'CartTest.java'),
        line: 20,
      });
      expect(byId.get('com.shop.CartTest#[1] 1, 2, 3')).toMatchObject({
        parentId: 'com.shop.CartTest',
        label: '[1] 1, 2, 3',
      });
    });

    it('jvmResults_readsSurefiresReport_invocationsUnderTheirMethod', async () => {
      const out: string = fs.mkdtempSync(path.join(scratch, 'out-'));
      await stampStart(out, Date.now() - 60_000);
      place(
        maven,
        'maven',
        'surefire-TEST-com.shop.PricingTest.xml',
        'TEST-com.shop.PricingTest.xml',
      );

      const results: TestRunResults = await jvmResults(
        discovery,
        ['jvm:maven-pricing'],
        out,
        '',
        1,
      );

      expect(
        results.results.map((result: TestResult): [string, string, string | undefined] => [
          result.id,
          result.outcome,
          result.parentId,
        ]),
      ).toEqual([
        ['com.shop.PricingTest#rounds', 'failed', undefined],
        ['com.shop.PricingTest#discounts', 'passed', undefined],
        ['com.shop.PricingTest#later', 'skipped', undefined],
        ['com.shop.PricingTest#positive[1]', 'passed', 'com.shop.PricingTest#positive'],
        ['com.shop.PricingTest#positive[2]', 'passed', 'com.shop.PricingTest#positive'],
        ['com.shop.PricingTest#positive[3]', 'failed', 'com.shop.PricingTest#positive'],
      ]);
      expect(results.results[0]).toMatchObject({
        message: 'rounding ==> expected: <1> but was: <2>',
      });
      expect(
        results.results[0].stack?.find((frame) => frame.location !== undefined)?.location,
      ).toEqual({
        file: path.join(maven, 'src', 'test', 'java', 'com', 'shop', 'PricingTest.java'),
        line: 18,
      });
    });

    it('jvmResults_skipsReportsOlderThanTheRun_andSaysWhenThereAreNone', async () => {
      const out: string = fs.mkdtempSync(path.join(scratch, 'out-'));
      const file: string = place(
        maven,
        'maven',
        'surefire-TEST-com.shop.PricingTest.xml',
        'TEST-com.shop.PricingTest.xml',
      );
      const old: Date = new Date(Date.now() - 3_600_000);
      fs.utimesSync(file, old, old);
      await stampStart(out);

      expect(
        await jvmResults(
          discovery,
          ['jvm:maven-pricing'],
          out,
          'BUILD FAILURE\n[ERROR] no Java',
          1,
        ),
      ).toEqual({
        results: [],
        problem: 'The build wrote no test report (exit code 1).\nBUILD FAILURE\n[ERROR] no Java',
      });
    });
  });
});
