import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestCommand, TestDebugLaunch, TestNode } from '../../protocol/testing/protocol';
import type { Runner } from './adapter';
import { discoverJs, frameworksOf, JsDiscovery, playwrightTestDir } from './discover';
import { commandFor, debugLaunchFor, namePattern, planSteps, Step, stepArguments } from './plan';

/**
 * Writes files into a folder.
 * @param root The folder.
 * @param files The files, by relative path.
 */
function write(root: string, files: Readonly<Record<string, string>>): void {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
}

/**
 * Reduces a tree to `kind label`, nested.
 * @param nodes The nodes.
 * @returns Returns the outline.
 */
function outline(nodes: readonly TestNode[]): unknown[] {
  return nodes.map((node: TestNode): unknown =>
    node.children !== undefined && node.children.length > 0
      ? {
          [`${node.kind} ${node.label}${node.framework ? ` [${node.framework}]` : ''}`]: outline(
            node.children,
          ),
        }
      : `${node.kind} ${node.label}`,
  );
}

describe('JavaScript discovery and plans (#1354)', () => {
  let root: string = '';
  let discovery: JsDiscovery;

  beforeAll(async () => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'js-tests-')));
    write(root, {
      'package.json': JSON.stringify({ name: 'mono', private: true }),
      'web/package.json': JSON.stringify({
        name: 'web',
        devDependencies: { vitest: '3', '@playwright/test': '1' },
      }),
      'web/src/a.test.ts': "describe('a', () => { it('works', () => {}); });",
      'web/e2e/home.spec.ts': "test('loads', () => {});",
      'web/node_modules/dep/x.test.js': "it('never', () => {});",
      'web/node_modules/.bin/vitest': '',
      'web/node_modules/.bin/playwright': '',
      'web/node_modules/vitest/vitest.mjs': '',
      'api/package.json': JSON.stringify({ name: 'api', devDependencies: { jest: '30' } }),
      'api/__tests__/b.test.js': "test('b', () => {});",
      'lib/package.json': JSON.stringify({ name: 'lib' }),
      'lib/c.test.js': "test('c', () => {});",
    });
    discovery = await discoverJs(root);
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('frameworksOf_readsDependenciesAndConfigs', () => {
    expect(frameworksOf({ devDependencies: { vitest: '3' } }, [])).toEqual(['vitest']);
    expect(frameworksOf({ jest: {} }, [])).toEqual(['jest']);
    expect(frameworksOf({ devDependencies: { vitest: '3', jest: '30' } }, [])).toEqual(['vitest']);
    expect(
      frameworksOf({ devDependencies: { vitest: '3', jest: '30' } }, ['jest.config.js']),
    ).toEqual(['jest']);
    expect(frameworksOf({}, ['playwright.config.ts'])).toEqual(['playwright']);
    expect(frameworksOf({ dependencies: { react: '19' } }, [])).toEqual([]);
  });

  it('playwrightTestDir_readsALiteralOnly', () => {
    expect(playwrightTestDir("export default defineConfig({ testDir: './tests' })")).toBe(
      './tests',
    );
    expect(playwrightTestDir('export default defineConfig({ testDir: dir })')).toBeUndefined();
  });

  it('discoverJs_drawsPackageFileSuiteTest_givingPlaywrightItsFolder_andSkippingInstalledCode', () => {
    expect(outline(discovery.tests)).toEqual([
      { 'project api [Jest]': [{ 'file __tests__/b.test.js [Jest]': ['test b'] }] },
      {
        'project web': [
          { 'file e2e/home.spec.ts [Playwright Test]': ['test loads'] },
          { 'file src/a.test.ts [Vitest]': [{ 'suite a': ['test works'] }] },
        ],
      },
    ]);
  });

  it('namePattern_matchesTestsExactlyAndSuitesByPrefix', () => {
    const pattern: RegExp = new RegExp(
      namePattern([
        { file: 'f', titles: ['math', 'adds (1+1)'], suite: false, line: 1 },
        { file: 'f', titles: ['nested'], suite: true, line: 1 },
      ]),
    );

    expect(
      ['math adds (1+1)', 'nested', 'nested deep'].every((name: string): boolean =>
        pattern.test(name),
      ),
    ).toBe(true);
    expect(
      ['math adds (1+1) too', 'nestedness'].some((name: string): boolean => pattern.test(name)),
    ).toBe(false);
  });

  it('planSteps_runsEveryPackageAndFramework_forAnEmptyRequest', () => {
    const steps: readonly Step[] = planSteps(discovery, []);

    expect(
      steps.map(
        (step: Step): string => `${step.owner.name}:${step.framework}:${step.files.length}`,
      ),
    ).toEqual(['api:jest:0', 'web:playwright:0', 'web:vitest:0']);
  });

  it('planSteps_splitsWholeFilesFromNarrowedTests_andDropsTestsInsideAWholeFile', () => {
    const file: string = path.join(root, 'web', 'src', 'a.test.ts');
    const steps: readonly Step[] = planSteps(discovery, [`${file}::a > works`, `file:${file}`]);

    expect(steps).toHaveLength(1);
    expect(steps[0].files).toEqual([file]);
    expect(steps[0].selected).toEqual([]);
  });

  it('stepArguments_buildEachFrameworksCommandLine', () => {
    const steps: readonly Step[] = planSteps(discovery, [
      `${path.join(root, 'web', 'src', 'a.test.ts')}::a > works`,
      `${path.join(root, 'web', 'e2e', 'home.spec.ts')}::loads`,
      `file:${path.join(root, 'api', '__tests__', 'b.test.js')}`,
    ]);

    expect(steps.map((step: Step) => stepArguments(step, '/out/r.json'))).toEqual([
      {
        args: [
          'run',
          '--reporter=default',
          '--reporter=json',
          '--outputFile.json=/out/r.json',
          'src/a.test.ts',
          '-t',
          '^a works$',
        ],
        env: {},
      },
      {
        args: ['test', '--reporter=list,json', 'e2e/home.spec.ts:1'],
        env: { PLAYWRIGHT_JSON_OUTPUT_NAME: '/out/r.json' },
      },
      {
        args: ['--json', '--outputFile=/out/r.json', '--runTestsByPath', '__tests__/b.test.js'],
        env: {},
      },
    ]);
  });

  it('commandFor_runsOneStepDirectly_andSeveralThroughTheRunner', () => {
    const runner: Runner = {
      executable: '/studio',
      args: ['/plugin/main.js'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    };
    const one: TestCommand = commandFor(
      planSteps(discovery, [`file:${path.join(root, 'web', 'src', 'a.test.ts')}`]),
      root,
      '/out',
      runner,
    );
    const several: TestCommand = commandFor(
      planSteps(discovery, [`package:${path.join(root, 'web')}`]),
      root,
      '/out',
      runner,
    );

    expect(one).toMatchObject({
      executable: path.join(root, 'web', 'node_modules', '.bin', 'vitest'),
      cwd: path.join(root, 'web'),
      title: 'Test web (Vitest)',
    });
    expect(several).toMatchObject({ executable: '/studio', cwd: root, title: 'Test 2 packages' });
    expect(several.args.slice(0, 2)).toEqual(['/plugin/main.js', '--run-steps']);
    expect(
      (JSON.parse(several.args[2]) as { label: string }[]).map(
        (step: { label: string }) => step.label,
      ),
    ).toEqual(['web (Playwright Test)', 'web (Vitest)']);
  });

  it('commandFor_saysWhenAPackagesToolIsNotInstalled', () => {
    expect(() =>
      commandFor(planSteps(discovery, [`package:${path.join(root, 'api')}`]), root, '/out', {
        executable: '/studio',
        args: [],
        env: {},
      }),
    ).toThrow('api has no Jest installed. Install its dependencies first.');
  });

  it('debugLaunchFor_launchesTheFrameworkScriptInBand', () => {
    const launch: TestDebugLaunch = debugLaunchFor(
      discovery,
      `${path.join(root, 'web', 'src', 'a.test.ts')}::a > works`,
      root,
    );

    expect(launch).toEqual({
      adapter: 'js-debug',
      title: 'Debug works',
      program: path.join(root, 'web', 'node_modules', 'vitest', 'vitest.mjs'),
      args: [
        'run',
        '--no-file-parallelism',
        '--test-timeout=0',
        'src/a.test.ts',
        '-t',
        '^a works$',
      ],
      cwd: path.join(root, 'web'),
      configuration: { autoAttachChildProcesses: true },
    });
  });
});
