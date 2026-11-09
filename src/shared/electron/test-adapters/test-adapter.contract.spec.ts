import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  TestDiscoverAnswer,
  TestResultsAnswer,
  TestRunPlanAnswer,
} from '@shared/api/test-channels';
import type { RepositoryTrustDecision } from '@shared/api/source-control-channels';
import { TestAdapterDescriptor, TestAdapterResolution } from './test-adapter-descriptor';
import { TestAdapterHost } from './test-adapter-host';

/**
 * The per-test timeout: the adapter is a real process.
 */
const TIMEOUT: number = 30_000;

/**
 * A fixture adapter written against the shared plugin toolkit (`plugins/protocol/testing`), as a real
 * adapter is: it discovers `*.check` files and runs them with `node`, reading results from a JUnit file
 * its command writes into the run's output folder.
 * @param toolkit The absolute path of the toolkit.
 * @returns Returns the adapter's source.
 */
function fixtureAdapter(toolkit: string): string {
  return `
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { serve } from ${JSON.stringify(path.join(toolkit, 'serve'))};
import { readJUnit } from ${JSON.stringify(path.join(toolkit, 'reports'))};
import { walkFiles } from ${JSON.stringify(path.join(toolkit, 'source'))};

serve({
  capabilities: ['run', 'runSelected'],
  toolVersion: async () => '0.0.1',
  discover: async (root) => {
    const files = await walkFiles(root, { accept: (name) => name.endsWith('.check') });
    return [{
      id: 'project',
      label: path.basename(root),
      kind: 'project',
      framework: 'Check',
      children: files.map((file) => ({ id: path.basename(file, '.check'), label: path.basename(file, '.check'), kind: 'test', location: { file, line: 1 } })),
    }];
  },
  run: async (root, params) => ({
    executable: process.execPath,
    args: ['-e', 'require("fs").writeFileSync(process.argv[1], process.argv[2])', path.join(params.outputDirectory, 'report.xml'),
      '<testsuite name="checks">' + params.ids.map((id) => '<testcase classname="checks" name="' + id + '"' + (id === 'fails' ? '><failure message="nope">at check (' + path.join(root, 'fails.check') + ':1:1)</failure></testcase>' : '/>')).join('') + '</testsuite>'],
    cwd: root,
    title: 'Test ' + path.basename(root),
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }),
  results: async (root, params) => {
    const report = await fs.readFile(path.join(params.outputDirectory, 'report.xml'), 'utf8');
    return { results: readJUnit(report).map((test) => ({ id: test.name, outcome: test.outcome, message: test.message, stack: test.details === undefined ? undefined : [{ text: test.details, location: { file: path.join(root, test.name + '.check'), line: 1 } }] })) };
  },
});
`;
}

/**
 * The contract between core's test-adapter host and an adapter built on the shared toolkit (#1351),
 * across the real process boundary: the adapter is bundled as a plugin's build does, spawned under Node,
 * and spoken to by the host's own client. Its command is run here as Studio's terminal would run it.
 */
describe('test adapter contract (#1351)', () => {
  let scratch: string = '';
  let workspace: string = '';
  let bundle: string = '';
  let host: TestAdapterHost;

  beforeAll(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'test-adapter-contract-')));
    workspace = path.join(scratch, 'workspace');
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(workspace, 'passes.check'), '');
    fs.writeFileSync(path.join(workspace, 'fails.check'), '');
    fs.writeFileSync(path.join(workspace, 'checks.marker'), '');
    const source: string = path.join(scratch, 'main.ts');
    fs.writeFileSync(source, fixtureAdapter(path.resolve('plugins/protocol/testing')));
    bundle = path.join(scratch, 'main.js');
    // esbuild's CLI rather than its API: the unit suite runs under jsdom, whose TextEncoder esbuild's
    // in-process API refuses.
    execFileSync(path.resolve('node_modules/.bin/esbuild'), [
      source,
      '--bundle',
      '--platform=node',
      '--target=node22',
      '--format=cjs',
      `--outfile=${bundle}`,
      '--log-level=error',
    ]);
    host = new TestAdapterHost({
      descriptors: (): readonly TestAdapterDescriptor[] => [
        {
          id: 'local.checks',
          displayName: 'Checks',
          frameworks: ['Check'],
          priority: 100,
          markers: ['*.marker'],
          capabilities: ['run', 'runSelected'],
          resolve: (): TestAdapterResolution => ({
            available: true,
            spec: { command: 'node', args: [bundle] },
          }),
        },
      ],
      roots: { isWithin: (target: unknown): boolean => String(target).startsWith(workspace) },
      trust: { decisionFor: (): RepositoryTrustDecision => 'trusted' },
    });
  });

  afterAll(() => {
    host.dispose();
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it(
    'discover_findsTheFixturesTestsWithLinksIntoTheFolder',
    async () => {
      expect((await host.adaptersFor(workspace)).map((info) => info.pluginId)).toEqual([
        'local.checks',
      ]);

      const answer: TestDiscoverAnswer = await host.discover('local.checks', workspace);

      expect(answer).toEqual({
        ok: true,
        value: {
          tests: [
            {
              id: 'project',
              label: 'workspace',
              kind: 'project',
              framework: 'Check',
              children: [
                {
                  id: 'fails',
                  label: 'fails',
                  kind: 'test',
                  location: { file: path.join(workspace, 'fails.check'), line: 1 },
                },
                {
                  id: 'passes',
                  label: 'passes',
                  kind: 'test',
                  location: { file: path.join(workspace, 'passes.check'), line: 1 },
                },
              ],
            },
          ],
        },
      });
    },
    TIMEOUT,
  );

  it(
    'planRun_thenResults_readsWhatTheCommandWroteIntoTheOutputFolder_andRemovesIt',
    async () => {
      const plan: TestRunPlanAnswer = await host.planRun('local.checks', workspace, [
        'passes',
        'fails',
      ]);
      if (!plan.ok) {
        throw new Error(plan.error);
      }
      const { command } = plan.value;
      const output: string = path.dirname(command.args[2]);
      expect(output.startsWith(workspace)).toBe(false);

      // What Studio's Tests terminal does with the plan.
      execFileSync(command.executable, [...command.args], {
        cwd: command.cwd,
        env: { ...process.env, ...command.env },
      });
      const answer: TestResultsAnswer = await host.results(plan.value.runId, 0, 'ran');

      expect(answer).toEqual({
        ok: true,
        value: {
          results: [
            { id: 'passes', outcome: 'passed' },
            {
              id: 'fails',
              outcome: 'failed',
              message: 'nope',
              stack: [
                {
                  text: `at check (${path.join(workspace, 'fails.check')}:1:1)`,
                  location: { file: path.join(workspace, 'fails.check'), line: 1 },
                },
              ],
            },
          ],
        },
      });
      expect(fs.existsSync(output)).toBe(false);
    },
    TIMEOUT,
  );
});
