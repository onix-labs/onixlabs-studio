import { describe, expect, it } from 'vitest';
import type { TestCommand, TestNode } from '../../protocol/testing/protocol';
import { escapeFilterValue, PlanContext, planRun, usesTestingPlatform } from './command';

/**
 * A tree of two test projects, two classes in the first.
 */
const TREE: readonly TestNode[] = [
  {
    id: 'project:/repo/A.Tests/A.Tests.csproj',
    label: 'A.Tests',
    kind: 'project',
    children: [
      {
        id: 'A.Tests.One',
        label: 'A.Tests.One',
        kind: 'suite',
        children: [{ id: 'A.Tests.One.Adds', label: 'Adds', kind: 'test' }],
      },
      {
        id: 'A.Tests.Two',
        label: 'A.Tests.Two',
        kind: 'suite',
        children: [{ id: 'A.Tests.Two.Holds', label: 'Holds', kind: 'test' }],
      },
    ],
  },
  {
    id: 'project:/repo/B.Tests/B.Tests.csproj',
    label: 'B.Tests',
    kind: 'project',
    children: [
      {
        id: 'B.Tests.Three',
        label: 'B.Tests.Three',
        kind: 'suite',
        children: [{ id: 'B.Tests.Three.Works', label: 'Works', kind: 'test' }],
      },
    ],
  },
];

/**
 * The folder every plan is made in, with one solution.
 */
const CONTEXT: PlanContext = {
  root: '/repo',
  solutions: ['/repo/All.sln'],
  testingPlatform: false,
  outputDirectory: '/tmp/out',
};

/**
 * Reads a plan's filter.
 * @param command The command.
 * @returns Returns the filter, or undefined when it has none.
 */
function filterOf(command: TestCommand): string | undefined {
  const at: number = command.args.indexOf('--filter');
  return at < 0 ? undefined : command.args[at + 1];
}

describe('.NET run plans (#1353)', () => {
  it('planRun_everything_runsTheSolutionUnfiltered_writingTrxIntoTheOutputFolder', () => {
    const command: TestCommand = planRun(TREE, [], CONTEXT);

    expect(command).toEqual({
      executable: 'dotnet',
      args: ['test', '/repo/All.sln', '--logger', 'trx', '--results-directory', '/tmp/out'],
      cwd: '/repo',
      title: 'Test All',
      env: { DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1' },
    });
  });

  it('planRun_oneTest_runsItsProjectFilteredToTheExactName', () => {
    const command: TestCommand = planRun(TREE, ['A.Tests.One.Adds'], CONTEXT);

    expect(command.args.slice(0, 2)).toEqual(['test', '/repo/A.Tests/A.Tests.csproj']);
    expect(filterOf(command)).toBe('FullyQualifiedName=A.Tests.One.Adds');
    expect(command.title).toBe('Test A.Tests (selected)');
  });

  it('planRun_aClass_matchesItsTestsAndNestedTypes', () => {
    expect(filterOf(planRun(TREE, ['A.Tests.Two'], CONTEXT))).toBe(
      'FullyQualifiedName~A.Tests.Two.|FullyQualifiedName~A.Tests.Two+',
    );
  });

  it('planRun_aWholeProject_runsItUnfiltered', () => {
    const command: TestCommand = planRun(TREE, ['project:/repo/B.Tests/B.Tests.csproj'], CONTEXT);

    expect(command.args[1]).toBe('/repo/B.Tests/B.Tests.csproj');
    expect(filterOf(command)).toBeUndefined();
  });

  it('planRun_acrossProjects_runsTheSolution_withAProjectAskedForWholeSpelledOutByItsClasses', () => {
    const command: TestCommand = planRun(
      TREE,
      ['project:/repo/A.Tests/A.Tests.csproj', 'B.Tests.Three.Works'],
      CONTEXT,
    );

    expect(command.args[1]).toBe('/repo/All.sln');
    expect(filterOf(command)).toBe(
      'FullyQualifiedName~A.Tests.One.|FullyQualifiedName~A.Tests.One+|FullyQualifiedName~A.Tests.Two.|FullyQualifiedName~A.Tests.Two+|FullyQualifiedName=B.Tests.Three.Works',
    );
  });

  it('planRun_everyProjectWhole_runsTheSolutionUnfiltered', () => {
    expect(
      filterOf(
        planRun(
          TREE,
          ['project:/repo/A.Tests/A.Tests.csproj', 'project:/repo/B.Tests/B.Tests.csproj'],
          CONTEXT,
        ),
      ),
    ).toBeUndefined();
  });

  it.each<[string, readonly string[]]>([
    ['no solution', []],
    ['two solutions', ['/repo/A.sln', '/repo/B.sln']],
  ])(
    'planRun_acrossProjectsWith %s_isRefusedRatherThanRunPartly',
    (_name: string, solutions: readonly string[]) => {
      expect(() =>
        planRun(TREE, ['A.Tests.One.Adds', 'B.Tests.Three.Works'], { ...CONTEXT, solutions }),
      ).toThrow(/several projects/);
    },
  );

  it.each<[string, readonly TestNode[], readonly string[]]>([
    ['a folder with no test projects', [], []],
    ['ids the tree does not hold', TREE, ['Nope.Nothing']],
  ])(
    'planRun_withNothingToRun_isRefused: %s',
    (_name: string, tree: readonly TestNode[], ids: readonly string[]) => {
      expect(() => planRun(tree, ids, CONTEXT)).toThrow();
    },
  );

  it('planRun_underTheTestingPlatform_usesItsArgumentsAndRunsTheWholeTarget', () => {
    const command: TestCommand = planRun(TREE, ['A.Tests.One.Adds'], {
      ...CONTEXT,
      testingPlatform: true,
    });

    expect(command.args).toEqual([
      'test',
      '--project',
      '/repo/A.Tests/A.Tests.csproj',
      '--report-trx',
      '--results-directory',
      '/tmp/out',
    ]);
  });

  it('escapeFilterValue_escapesWhatTheFilterReadsAsSyntax', () => {
    expect(escapeFilterValue('A.B(x|y)&!~=\\')).toBe('A.B\\(x\\|y\\)\\&\\!\\~\\=\\\\');
  });

  it.each<[string | null, boolean]>([
    ['{"test": {"runner": "Microsoft.Testing.Platform"}}', true],
    ['{"test": {"runner": "VSTest"}}', false],
    ['{"sdk": {"version": "10.0.100"}}', false],
    ['not json', false],
    [null, false],
  ])('usesTestingPlatform(%s) is %s', (json: string | null, expected: boolean) => {
    expect(usesTestingPlatform(json)).toBe(expected);
  });
});
