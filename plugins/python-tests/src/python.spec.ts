import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  TestCommand,
  TestDebugLaunch,
  TestNode,
  TestResult,
  TestRunResults,
} from '../../protocol/testing/protocol';
import type { Runner } from './adapter';
import { discoverPython, PythonDeclaration, PythonDiscovery, scanPython } from './discover';
import { commandFor, debugLaunchFor, interpreterFor, planSteps, Step, STEPS_FILE } from './plan';
import { caseId, readRunReports, resultsFromReport } from './reports';

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
 * Reduces declarations to `kind name:line`, nested.
 * @param declarations The declarations.
 * @returns Returns the outline.
 */
function outline(declarations: readonly PythonDeclaration[]): unknown[] {
  return declarations.map((declaration: PythonDeclaration): unknown =>
    declaration.kind === 'suite'
      ? { [`${declaration.name}:${declaration.line}`]: outline(declaration.children) }
      : `${declaration.name}:${declaration.line}`,
  );
}

/**
 * The JUnit report pytest 9.2.0 wrote for the fixture this plugin was verified against, trimmed.
 */
const REPORT: string = `<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="0" failures="2" skipped="1" tests="6">
<testcase classname="tests.test_legacy.LegacyTests" name="test_adds" time="0.001" />
<testcase classname="tests.test_math" name="test_fails_on_purpose" time="0.000"><failure message="assert 2 == 3&#10; +  where 2 = add(1, 1)">def test_fails_on_purpose():
&gt;       assert add(1, 1) == 3
E       assert 2 == 3

tests/test_math.py:11: AssertionError</failure></testcase>
<testcase classname="tests.test_math" name="test_is_skipped" time="0.000"><skipped type="pytest.skip" message="not today">/r/tests/test_math.py:14: not today</skipped></testcase>
<testcase classname="tests.test_math" name="test_parametrised[2-2-5]" time="0.001"><failure message="assert 4 == 5">tests/test_math.py:21: AssertionError</failure></testcase>
<testcase classname="tests.test_math.TestGroup" name="test_in_class" time="0.000" />
<testcase classname="elsewhere.test_x" name="test_lost" time="0.000" />
</testsuite></testsuites>`;

describe('Python test adapter (#1355)', () => {
  it('scanPython_findsFunctionsTestClassesAndTestCases_asPytestCollectsThem', () => {
    const source: string = `import unittest

def test_top():
    def test_inner():
        pass

async def test_async():
    pass

def helper():
    pass

class TestGroup:
    def test_one(self):
        """
        def test_in_a_docstring(): pass
        """

    class TestNested:
        def test_deep(self):
            pass

class Legacy(unittest.TestCase):
    def test_case(self):
        pass

    def setUp(self):
        pass

class NotATest:
    def test_ignored(self):
        pass

class TestEmpty:
    pass
`;

    expect(outline(scanPython(source))).toEqual([
      'test_top:3',
      'test_async:7',
      { 'TestGroup:13': ['test_one:14', { 'TestNested:19': ['test_deep:20'] }] },
      { 'Legacy:23': ['test_case:24'] },
    ]);
  });

  describe('a folder of projects', () => {
    let root: string = '';
    let discovery: PythonDiscovery;
    const runner: Runner = {
      executable: '/studio',
      args: ['/plugin/main.js'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    };

    beforeAll(async () => {
      root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'python-tests-')));
      write(root, {
        'calc/pyproject.toml': '[project]\nname = "calc"\n',
        'calc/tests/conftest.py': '',
        'calc/tests/test_math.py':
          'def test_adds():\n    pass\n\nclass TestGroup:\n    def test_in_class(self):\n        pass\n',
        'calc/.venv/bin/python': '',
        'calc/.venv/lib/site-packages/pkg/test_vendor.py': 'def test_never():\n    pass\n',
        'tools/requirements-dev.txt': '',
        'tools/check_test.py': 'def test_tool():\n    pass\n',
        'loose/test_loose.py': 'def test_loose():\n    pass\n',
      });
      discovery = await discoverPython(root);
    });

    afterAll(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('discoverPython_drawsProjectFileClassTest_skippingVirtualEnvironments', () => {
      const shape: (nodes: readonly TestNode[]) => unknown[] = (
        nodes: readonly TestNode[],
      ): unknown[] =>
        nodes.map((node: TestNode): unknown =>
          node.children !== undefined
            ? { [`${node.kind} ${node.label}`]: shape(node.children) }
            : `${node.kind} ${node.label}`,
        );

      // `loose` has no marker, so it runs from the root; `conftest.py` marks a test folder, not a project.
      expect(discovery.projects).toEqual([root, path.join(root, 'calc'), path.join(root, 'tools')]);
      expect(shape(discovery.tests)).toEqual([
        {
          [`project ${path.basename(root)}`]: [{ 'file loose/test_loose.py': ['test test_loose'] }],
        },
        {
          'project calc': [
            {
              'file tests/test_math.py': [
                'test test_adds',
                { 'suite TestGroup': ['test test_in_class'] },
              ],
            },
          ],
        },
        { 'project tools': [{ 'file check_test.py': ['test test_tool'] }] },
      ]);
      expect(discovery.tests[1].children?.[0].children?.[1].id).toBe(
        `${path.join(root, 'calc', 'tests', 'test_math.py')}::TestGroup`,
      );
    });

    it('interpreterFor_prefersTheProjectsVirtualEnvironment', () => {
      expect(interpreterFor(path.join(root, 'calc'), root)).toBe(
        path.join(root, 'calc', '.venv', 'bin', 'python'),
      );
      expect(interpreterFor(path.join(root, 'tools'), root)).toBe('python3');
    });

    it('planSteps_turnsIdsIntoNodeIdsPerProject_aWholeProjectWinning', () => {
      const math: string = path.join(root, 'calc', 'tests', 'test_math.py');
      const steps: readonly Step[] = planSteps(discovery, [
        `${math}::TestGroup::test_in_class`,
        `file:${path.join(root, 'tools', 'check_test.py')}`,
        `project:${root}`,
        `${path.join(root, 'loose', 'test_loose.py')}::test_loose`,
      ]);

      expect(steps).toEqual([
        { project: root, nodeIds: [] },
        {
          project: path.join(root, 'calc'),
          nodeIds: ['tests/test_math.py::TestGroup::test_in_class'],
        },
        { project: path.join(root, 'tools'), nodeIds: ['check_test.py'] },
      ]);
      expect(planSteps(discovery, [])).toHaveLength(3);
    });

    it('commandFor_runsOneProjectsPytestDirectly_andRecordsWhichReportIsWhose', async () => {
      const out: string = fs.mkdtempSync(path.join(os.tmpdir(), 'python-out-'));
      const command: TestCommand = await commandFor(
        planSteps(discovery, [`${path.join(root, 'calc', 'tests', 'test_math.py')}::test_adds`]),
        root,
        out,
        runner,
      );

      expect(command).toEqual({
        executable: path.join(root, 'calc', '.venv', 'bin', 'python'),
        args: [
          '-m',
          'pytest',
          `--rootdir=${path.join(root, 'calc')}`,
          '-p',
          'no:cacheprovider',
          `--junitxml=${path.join(out, '1-pytest.xml')}`,
          '-o',
          'junit_family=xunit2',
          'tests/test_math.py::test_adds',
        ],
        cwd: path.join(root, 'calc'),
        title: 'Test calc',
      });
      expect(JSON.parse(fs.readFileSync(path.join(out, STEPS_FILE), 'utf8'))).toEqual([
        { report: '1-pytest.xml', project: path.join(root, 'calc') },
      ]);
      const several: TestCommand = await commandFor(planSteps(discovery, []), root, out, runner);
      expect(several).toMatchObject({ executable: '/studio', cwd: root, title: 'Test 3 projects' });
      fs.rmSync(out, { recursive: true, force: true });
    });

    it('debugLaunchFor_runsPytestAsAModuleUnderTheProjectsInterpreter', () => {
      const launch: TestDebugLaunch = debugLaunchFor(
        discovery,
        `${path.join(root, 'calc', 'tests', 'test_math.py')}::TestGroup`,
        root,
      );

      expect(launch).toEqual({
        adapter: 'debugpy',
        title: 'Debug TestGroup',
        args: [
          `--rootdir=${path.join(root, 'calc')}`,
          '-p',
          'no:cacheprovider',
          'tests/test_math.py::TestGroup',
          '-q',
        ],
        cwd: path.join(root, 'calc'),
        configuration: {
          module: 'pytest',
          justMyCode: true,
          python: path.join(root, 'calc', '.venv', 'bin', 'python'),
        },
      });
      expect(() => debugLaunchFor(discovery, `project:${root}`, root)).toThrow();
    });
  });

  describe('reports', () => {
    const project: string = '/r';
    const files: readonly string[] = [
      '/r/tests/test_math.py',
      '/r/tests/test_legacy.py',
      '/r/tests/test_math_more.py',
    ];

    it('caseId_findsTheFileByTheLongestModulePrefix_andTheClassesAfterIt', () => {
      expect(
        caseId(
          {
            suite: '',
            classname: 'tests.test_math.TestGroup',
            name: 'test_in_class',
            outcome: 'passed',
          },
          project,
          files,
        ),
      ).toEqual({
        id: '/r/tests/test_math.py::TestGroup::test_in_class',
        file: '/r/tests/test_math.py',
      });
      expect(
        caseId(
          { suite: '', classname: 'tests.test_math_more', name: 'test_x[1]', outcome: 'passed' },
          project,
          files,
        ),
      ).toEqual({
        id: '/r/tests/test_math_more.py::test_x[1]',
        parentId: '/r/tests/test_math_more.py::test_x',
        file: '/r/tests/test_math_more.py',
      });
      expect(
        caseId(
          { suite: '', classname: 'nowhere', name: 'test_y', outcome: 'passed' },
          project,
          files,
        ),
      ).toBeUndefined();
    });

    it('resultsFromReport_readsEachOutcome_linkingTheFailureToItsLine', () => {
      const results: readonly TestResult[] = resultsFromReport(REPORT, project, files);

      expect(results.map((result: TestResult) => [result.id, result.outcome])).toEqual([
        ['/r/tests/test_legacy.py::LegacyTests::test_adds', 'passed'],
        ['/r/tests/test_math.py::test_fails_on_purpose', 'failed'],
        ['/r/tests/test_math.py::test_is_skipped', 'skipped'],
        ['/r/tests/test_math.py::test_parametrised[2-2-5]', 'failed'],
        ['/r/tests/test_math.py::TestGroup::test_in_class', 'passed'],
      ]);
      expect(results[1].message).toBe('assert 2 == 3\n +  where 2 = add(1, 1)');
      expect(results[1].stack?.at(-1)).toEqual({
        text: 'tests/test_math.py:11: AssertionError',
        location: { file: '/r/tests/test_math.py', line: 11 },
      });
      expect(results[2]).toEqual({
        id: '/r/tests/test_math.py::test_is_skipped',
        outcome: 'skipped',
        durationMs: 0,
        message: 'not today',
      });
      expect(results[3]).toMatchObject({
        parentId: '/r/tests/test_math.py::test_parametrised',
        label: 'test_parametrised[2-2-5]',
      });
    });

    it('readRunReports_namesAProjectWhosePytestNeverStarted', async () => {
      const out: string = fs.mkdtempSync(path.join(os.tmpdir(), 'python-reports-'));
      fs.writeFileSync(path.join(out, '1-pytest.xml'), REPORT);
      fs.writeFileSync(
        path.join(out, STEPS_FILE),
        JSON.stringify([
          { report: '1-pytest.xml', project: '/r' },
          { report: '2-pytest.xml', project: '/plain' },
        ]),
      );
      const discovery: PythonDiscovery = {
        projects: ['/r', '/plain'],
        files: files.map((file: string) => ({ file, project: '/r' })),
        tests: [],
      };

      const results: TestRunResults = await readRunReports(
        discovery,
        out,
        1,
        '/plain/.venv/bin/python: No module named pytest',
      );

      expect(results.results).toHaveLength(5);
      expect(results.problem).toBe(
        "plain: pytest is not installed in the project's Python. Install it (pip install pytest) and run again.",
      );
      fs.rmSync(out, { recursive: true, force: true });
    });
  });
});
