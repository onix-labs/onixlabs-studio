import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ManifestResult,
  ManifestTestAdapter,
  parsePluginManifest,
} from '@shared/api/plugin-manifest';
import type {
  TestDiscoverAnswer,
  TestResultsAnswer,
  TestRunPlanAnswer,
} from '@shared/api/test-channels';
import type { RepositoryTrustDecision } from '@shared/api/source-control-channels';
import { TestAdapterDescriptor, TestAdapterResolution } from './test-adapter-descriptor';
import { TestAdapterHost } from './test-adapter-host';

/**
 * The plugin's directory.
 */
const PLUGIN: string = path.resolve('plugins/dotnet-tests');

/**
 * The per-test timeout: the plugin is a real process.
 */
const TIMEOUT: number = 30_000;

/**
 * The contract between core and the .NET test adapter (#1353), across the real process boundary: the
 * plugin is bundled exactly as its build does, spawned under Node, and spoken to through core's own
 * host. ⛔ Nothing here runs `dotnet`: discovery reads files, a run is only planned, and its report is
 * written by the spec as `dotnet test` would write it.
 */
describe('.NET test adapter contract (#1353)', () => {
  let scratch: string = '';
  let workspace: string = '';
  let host: TestAdapterHost;

  beforeAll(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dotnet-tests-contract-')));
    workspace = path.join(scratch, 'workspace');
    fs.mkdirSync(path.join(workspace, 'Shop.Tests'), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, 'Shop.Tests', 'Shop.Tests.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="xunit" /></ItemGroup></Project>',
    );
    fs.writeFileSync(
      path.join(workspace, 'Shop.Tests', 'CartTests.cs'),
      'namespace Shop.Tests;\n\npublic class CartTests\n{\n    [Fact]\n    public void Adds() { }\n}\n',
    );
    const bundle: string = path.join(scratch, 'main.js');
    // esbuild's CLI rather than its API: the unit suite runs under jsdom, whose TextEncoder esbuild's
    // in-process API refuses.
    execFileSync(path.resolve('node_modules/.bin/esbuild'), [
      path.join(PLUGIN, 'src', 'main.ts'),
      '--bundle',
      '--platform=node',
      '--target=node22',
      '--format=cjs',
      `--outfile=${bundle}`,
      '--log-level=error',
    ]);
    const parsed: ManifestResult = parsePluginManifest(
      JSON.parse(fs.readFileSync(path.join(PLUGIN, 'plugin.json'), 'utf8')),
    );
    const contribution: ManifestTestAdapter | undefined =
      parsed.manifest?.contributes.testAdapters?.[0];
    host = new TestAdapterHost({
      descriptors: (): readonly TestAdapterDescriptor[] =>
        contribution === undefined
          ? []
          : [
              {
                id: contribution.id,
                displayName: contribution.displayName,
                frameworks: contribution.frameworks,
                priority: contribution.priority,
                markers: contribution.markers,
                capabilities: contribution.capabilities,
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

  it('pluginJson_isAValidManifestContributingOneTestAdapter', () => {
    const parsed: ManifestResult = parsePluginManifest(
      JSON.parse(fs.readFileSync(path.join(PLUGIN, 'plugin.json'), 'utf8')),
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.manifest?.contributes.testAdapters).toHaveLength(1);
  });

  it(
    'discover_throughTheHost_findsTheProjectClassAndTest',
    async () => {
      expect((await host.adaptersFor(workspace)).map((info) => info.pluginId)).toEqual([
        'onixlabs.dotnet-tests',
      ]);

      const answer: TestDiscoverAnswer = await host.discover('onixlabs.dotnet-tests', workspace);

      expect(answer.ok && answer.value.tests[0].children?.[0].children?.[0]).toEqual({
        id: 'Shop.Tests.CartTests.Adds',
        label: 'Adds',
        kind: 'test',
        location: { file: path.join(workspace, 'Shop.Tests', 'CartTests.cs'), line: 6 },
      });
    },
    TIMEOUT,
  );

  it(
    'planRun_thenResults_readsTheTrxTheCommandWouldWrite',
    async () => {
      const plan: TestRunPlanAnswer = await host.planRun('onixlabs.dotnet-tests', workspace, [
        'Shop.Tests.CartTests.Adds',
      ]);
      if (!plan.ok) {
        throw new Error(plan.error);
      }
      const args: readonly string[] = plan.value.command.args;
      expect(plan.value.command.executable).toBe('dotnet');
      expect(args.slice(0, 4)).toEqual([
        'test',
        path.join(workspace, 'Shop.Tests', 'Shop.Tests.csproj'),
        '--logger',
        'trx',
      ]);
      expect(args.slice(-2)).toEqual(['--filter', 'FullyQualifiedName=Shop.Tests.CartTests.Adds']);
      const output: string = args[args.indexOf('--results-directory') + 1];
      expect(output.startsWith(workspace)).toBe(false);

      // What `dotnet test --logger trx --results-directory <output>` writes.
      fs.writeFileSync(
        path.join(output, 'run.trx'),
        '<TestRun><Results><UnitTestResult testId="1" testName="Shop.Tests.CartTests.Adds" outcome="Passed" duration="00:00:00.0040000"/></Results>' +
          '<TestDefinitions><UnitTest id="1"><TestMethod className="Shop.Tests.CartTests" name="Adds"/></UnitTest></TestDefinitions></TestRun>',
      );
      const answer: TestResultsAnswer = await host.results(plan.value.runId, 0, '');

      expect(answer).toEqual({
        ok: true,
        value: {
          results: [
            {
              id: 'Shop.Tests.CartTests.Adds',
              outcome: 'passed',
              durationMs: 4,
              parentId: 'Shop.Tests.CartTests',
              label: 'Adds',
            },
          ],
        },
      });
    },
    TIMEOUT,
  );
});
