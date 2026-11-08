import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { frameLocation, lineIndex, readSource, stackFrames, walkFiles } from './source';
import { answer, TestAdapter } from './serve';

describe('test-adapter source helpers (#1351)', () => {
  let scratch: string = '';

  beforeAll(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tests-source-')));
    for (const file of [
      'a.test.ts',
      'src/b.test.ts',
      'node_modules/x/c.test.ts',
      '.git/d.test.ts',
      'src/e.ts',
    ]) {
      fs.mkdirSync(path.dirname(path.join(scratch, file)), { recursive: true });
      fs.writeFileSync(path.join(scratch, file), 'test');
    }
  });

  afterAll(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('walkFiles_findsWhatIsAccepted_skippingInstalledAndHiddenDirectories', async () => {
    const files: readonly string[] = await walkFiles(scratch, {
      accept: (name: string): boolean => name.endsWith('.test.ts'),
    });

    expect(files).toEqual([
      path.join(scratch, 'a.test.ts'),
      path.join(scratch, 'src', 'b.test.ts'),
    ]);
  });

  it('readSource_answersNullForAFileThatIsNotThere', async () => {
    expect(await readSource(path.join(scratch, 'missing.ts'))).toBeNull();
  });

  it('lineIndex_mapsOffsetsToLines', () => {
    const line: (offset: number) => number = lineIndex('one\ntwo\n\nfour');

    expect([line(0), line(3), line(4), line(8), line(9), line(13)]).toEqual([1, 1, 2, 3, 4, 4]);
  });

  it.each<[string, string, { file: string; line: number } | undefined]>([
    [
      '.NET',
      '   at Shop.CartTests.Adds() in /repo/Shop.Tests/CartTests.cs:line 14',
      { file: '/repo/Shop.Tests/CartTests.cs', line: 14 },
    ],
    [
      'Python',
      '  File "/repo/tests/test_math.py", line 8, in test_fails',
      { file: '/repo/tests/test_math.py', line: 8 },
    ],
    [
      'Node',
      '    at Object.<anonymous> (/repo/src/a.test.ts:12:5)',
      { file: '/repo/src/a.test.ts', line: 12 },
    ],
    [
      'a file URL',
      '    at file:///repo/src/a.test.ts:3:1',
      { file: '/repo/src/a.test.ts', line: 3 },
    ],
    [
      'Go, relative to the package',
      '    math_test.go:9: got 3, want 4',
      { file: '/repo/pkg/math_test.go', line: 9 },
    ],
    [
      'Rust, relative to the crate',
      "thread 'tests::fails' panicked at src/lib.rs:21:9:",
      { file: '/repo/pkg/src/lib.rs', line: 21 },
    ],
    ['nothing', 'AssertionError: expected 1 to be 2', undefined],
  ])(
    'frameLocation_reads %s',
    (_name: string, line: string, expected: { file: string; line: number } | undefined) => {
      expect(frameLocation(line, '/repo/pkg')).toEqual(expected);
    },
  );

  it('stackFrames_splitsAndTrims_linkingWhereItCan', () => {
    expect(stackFrames('  first\n\n  at x (/repo/a.ts:1:1)\n', '/repo')).toEqual([
      { text: 'first' },
      { text: 'at x (/repo/a.ts:1:1)', location: { file: '/repo/a.ts', line: 1 } },
    ]);
    expect(stackFrames(undefined, '/repo')).toEqual([]);
  });

  describe('answer', () => {
    const adapter: TestAdapter = {
      capabilities: ['run'],
      toolVersion: () => Promise.resolve('1.2.3'),
      discover: (root: string) => Promise.resolve([{ id: root, label: 'root', kind: 'project' }]),
      run: (root: string, params) =>
        Promise.resolve({
          executable: 'tool',
          args: [...params.ids],
          cwd: root,
          title: params.outputDirectory,
        }),
      results: (_root: string, params) =>
        Promise.resolve({ results: [], problem: `${params.exitCode}:${params.output}` }),
    };

    it('answersTheHandshakeWithTheProtocolAndCapabilities', async () => {
      expect(await answer(adapter, 'initialize', undefined, {})).toEqual({
        protocol: '1.0',
        capabilities: ['run'],
        toolVersion: '1.2.3',
      });
    });

    it('readsUntrustedParametersAsWhatTheyAre', async () => {
      expect(
        await answer(adapter, 'run', '/repo', { ids: ['a', 7], outputDirectory: '/out' }),
      ).toEqual({
        executable: 'tool',
        args: ['a'],
        cwd: '/repo',
        title: '/out',
      });
      expect(await answer(adapter, 'results', '/repo', { exitCode: 'no', output: 'x' })).toEqual({
        results: [],
        problem: '-1:x',
      });
    });

    it.each<[string, string | undefined]>([
      ['debug', '/repo'],
      ['discover', undefined],
      ['launch', '/repo'],
    ])('refuses %s when it cannot answer it', async (op: string, root: string | undefined) => {
      await expect(answer(adapter, op, root, {})).rejects.toThrow();
    });
  });
});
