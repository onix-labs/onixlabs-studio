import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DocumentFormatResult } from '@shared/api/project-system';
import {
  formatPython,
  formatterArgs,
  formatterCandidates,
  FormatterRunner,
  pythonFormatterFor,
  pythonProjectDir,
} from './python-formatter';

describe('pythonFormatterFor', () => {
  it('choosesRuffWithoutAPyproject', () => {
    expect(pythonFormatterFor(null)).toBe('ruff');
  });

  it('choosesRuffWhenThePyprojectDoesNotConfigureBlack', () => {
    const toml: string = ['[project]', 'name = "app"', '', '[tool.ruff]', 'line-length = 100'].join(
      '\n',
    );
    expect(pythonFormatterFor(toml)).toBe('ruff');
  });

  it('choosesBlackWhenThePyprojectConfiguresIt', () => {
    const toml: string = ['[project]', 'name = "app"', '', '[tool.black]', 'line-length = 88'].join(
      '\n',
    );
    expect(pythonFormatterFor(toml)).toBe('black');
  });

  it('doesNotMistakeASubTableOrAMentionForBlacksTable', () => {
    expect(pythonFormatterFor('[tool.blackhole]\nx = 1')).toBe('ruff');
    expect(pythonFormatterFor('# formatted like [tool.black] once\n[tool.ruff]')).toBe('ruff');
  });
});

describe('formatterArgs', () => {
  it('formatsStandardInputAsTheFileWithRuff', () => {
    expect(formatterArgs('ruff', '/w/app.py')).toEqual([
      'format',
      '--stdin-filename',
      '/w/app.py',
      '-',
    ]);
  });

  it('formatsStandardInputQuietlyAsTheFileWithBlack', () => {
    expect(formatterArgs('black', '/w/app.py')).toEqual([
      '--quiet',
      '--stdin-filename',
      '/w/app.py',
      '-',
    ]);
  });
});

describe('formatterCandidates', () => {
  it('looksInTheProjectsVenvsThenTheToolFoldersThenThePath', () => {
    expect(formatterCandidates('ruff', '/w', 'darwin', '/home/u')).toEqual([
      path.join('/w', '.venv', 'bin', 'ruff'),
      path.join('/w', 'venv', 'bin', 'ruff'),
      path.join('/w', 'env', 'bin', 'ruff'),
      path.join('/home/u', '.local', 'bin', 'ruff'),
      '/opt/homebrew/bin/ruff',
      '/usr/local/bin/ruff',
      'ruff',
    ]);
  });

  it('looksInTheVenvsScriptsFolderOnWindows', () => {
    expect(formatterCandidates('black', 'C:\\w', 'win32', 'C:\\Users\\u')).toEqual([
      path.join('C:\\w', '.venv', 'Scripts', 'black.exe'),
      path.join('C:\\w', 'venv', 'Scripts', 'black.exe'),
      path.join('C:\\w', 'env', 'Scripts', 'black.exe'),
      'black.exe',
    ]);
  });
});

describe('pythonProjectDir and formatPython', () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'python-formatter-')));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Builds a runner that answers every call the same way and records what it was asked to run.
   * @param answer What the runner resolves, or the error it rejects with.
   * @returns Returns the runner and the calls it saw.
   */
  function runner(answer: Awaited<ReturnType<FormatterRunner>> | Error): {
    run: FormatterRunner;
    calls: string[][];
  } {
    const calls: string[][] = [];
    const run: FormatterRunner = (executable: string, args: readonly string[], cwd: string) => {
      calls.push([executable, ...args, cwd]);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    };
    return { run, calls };
  }

  /**
   * Builds the error spawning a missing executable rejects with.
   * @returns Returns the error.
   */
  function missing(): Error {
    return Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
  }

  it('findsTheNearestPyprojectNoHigherThanTheRoot', () => {
    mkdirSync(path.join(root, 'services', 'api', 'src'), { recursive: true });
    writeFileSync(path.join(root, 'services', 'api', 'pyproject.toml'), '[project]\n');
    expect(pythonProjectDir(path.join(root, 'services', 'api', 'src', 'app.py'), root)).toBe(
      path.join(root, 'services', 'api'),
    );
    expect(pythonProjectDir(path.join(root, 'tools', 'x.py'), root)).toBe(root);
  });

  it('formatsWithRuffOnThePathWhenNothingConfiguresBlack', async () => {
    const { run, calls } = runner({ code: 0, stdout: 'x = 1\n', stderr: '' });
    const file: string = path.join(root, 'app.py');
    const result: DocumentFormatResult = await formatPython(file, 'x=1', root, run);
    expect(result).toEqual({ text: 'x = 1\n', error: null, formatter: 'ruff' });
    // The machine's own tool folders may hold a ruff, so only its name is pinned, not where it is.
    expect(calls).toHaveLength(1);
    expect(path.basename(calls[0]?.[0] ?? '')).toBe('ruff');
    expect(calls[0]?.slice(1)).toEqual(['format', '--stdin-filename', file, '-', root]);
  });

  it('prefersTheProjectsOwnVenv', async () => {
    mkdirSync(path.join(root, '.venv', 'bin'), { recursive: true });
    writeFileSync(path.join(root, '.venv', 'bin', 'ruff'), '');
    const { run, calls } = runner({ code: 0, stdout: 'x = 1\n', stderr: '' });
    await formatPython(path.join(root, 'app.py'), 'x=1', root, run);
    expect(calls[0]?.[0]).toBe(path.join(root, '.venv', 'bin', 'ruff'));
  });

  it('formatsWithBlackWhenTheProjectConfiguresIt', async () => {
    writeFileSync(path.join(root, 'pyproject.toml'), '[tool.black]\nline-length = 88\n');
    const { run, calls } = runner({ code: 0, stdout: 'x = 1\n', stderr: '' });
    const result: DocumentFormatResult = await formatPython(
      path.join(root, 'app.py'),
      'x=1',
      root,
      run,
    );
    expect(result.formatter).toBe('black');
    expect(path.basename(calls[0]?.[0] ?? '')).toBe('black');
    expect(calls[0]?.[1]).toBe('--quiet');
  });

  it('saysHowToInstallRuffWhenItIsMissing', async () => {
    const { run } = runner(missing());
    const result: DocumentFormatResult = await formatPython(
      path.join(root, 'app.py'),
      'x=1',
      root,
      run,
    );
    expect(result.text).toBeNull();
    expect(result.error).toBe(
      'Ruff is not installed. Install it in the project (pip install ruff) or on the PATH (pipx install ruff).',
    );
  });

  it('saysTheProjectFormatsWithBlackWhenBlackIsMissing', async () => {
    writeFileSync(path.join(root, 'pyproject.toml'), '[tool.black]\n');
    const { run } = runner(missing());
    const result: DocumentFormatResult = await formatPython(
      path.join(root, 'app.py'),
      'x=1',
      root,
      run,
    );
    expect(result.error).toContain('The project formats with black, which is not installed');
  });

  it('reportsTheFormattersFirstErrorLineWhenItFails', async () => {
    const { run } = runner({
      code: 2,
      stdout: '',
      stderr: 'error: Failed to parse app.py:1:3: Expected an expression\nmore detail\n',
    });
    const result: DocumentFormatResult = await formatPython(
      path.join(root, 'app.py'),
      'x=(',
      root,
      run,
    );
    expect(result).toEqual({
      text: null,
      error: 'ruff: error: Failed to parse app.py:1:3: Expected an expression',
      formatter: 'ruff',
    });
  });

  it('reportsAFailureWithoutAnyErrorOutput', async () => {
    const { run } = runner({ code: 1, stdout: '', stderr: '' });
    const result: DocumentFormatResult = await formatPython(
      path.join(root, 'app.py'),
      'x=1',
      root,
      run,
    );
    expect(result.error).toBe('ruff could not format the file.');
  });

  it('reportsAFormatterThatCannotBeStarted', async () => {
    const { run } = runner(Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }));
    const result: DocumentFormatResult = await formatPython(
      path.join(root, 'app.py'),
      'x=1',
      root,
      run,
    );
    expect(result.error).toBe('ruff could not be run.');
  });
});
