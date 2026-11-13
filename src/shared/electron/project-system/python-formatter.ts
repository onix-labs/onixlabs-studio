import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';
import type { DocumentFormatResult } from '@shared/api/project-system';
import { logger } from '../logger';

/**
 * Names a tool Python is formatted with (#1212).
 */
export type PythonFormatter = 'ruff' | 'black';

/**
 * Bounds how long a formatter may take on one document: they answer in well under a second, so one
 * that has not by now is stuck, and a save must not wait on it.
 */
const FORMAT_TIMEOUT_MS: number = 30_000;

/**
 * The project folders a virtual environment conventionally lives in, as the debugger looks for one.
 */
const VENV_FOLDERS: readonly string[] = ['.venv', 'venv', 'env'];

/**
 * Matches black's own table in `pyproject.toml`: a project that configures black is formatted with it.
 */
const BLACK_TABLE: RegExp = /^\s*\[tool\.black\]\s*$/m;

/**
 * Runs a formatter: the executable, its arguments, the folder to run in and the text on its standard
 * input. Injected so the choice and the error wording are testable without the tools.
 */
export type FormatterRunner = (
  executable: string,
  args: readonly string[],
  cwd: string,
  input: string,
) => Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }>;

/**
 * Chooses the formatter a project's Python is formatted with (Matthew's ruling on #1212): ruff, unless
 * the project configures black in its `pyproject.toml`.
 * @param pyproject The project's `pyproject.toml`, or null when it has none.
 * @returns Returns the formatter.
 */
export function pythonFormatterFor(pyproject: string | null): PythonFormatter {
  return pyproject !== null && BLACK_TABLE.test(pyproject) ? 'black' : 'ruff';
}

/**
 * Gets the arguments that format text read from standard input, as a file at a path would be — the
 * path decides which configuration applies and how it is reported, while nothing is written to disk.
 * @param formatter The formatter.
 * @param filePath The document's absolute path.
 * @returns Returns the arguments.
 */
export function formatterArgs(formatter: PythonFormatter, filePath: string): readonly string[] {
  return formatter === 'ruff'
    ? ['format', '--stdin-filename', filePath, '-']
    : ['--quiet', '--stdin-filename', filePath, '-'];
}

/**
 * Lists where a formatter is looked for, in order: the project's own virtual environment, the places
 * `pipx`, `uv tool` and Homebrew install tools — which a GUI launch's `PATH` often lacks — and then the
 * bare name, found on the `PATH`.
 * @param formatter The formatter.
 * @param projectDir The project's folder.
 * @param platform The operating system.
 * @param home The user's home folder.
 * @returns Returns the candidates.
 */
export function formatterCandidates(
  formatter: PythonFormatter,
  projectDir: string,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): readonly string[] {
  const windows: boolean = platform === 'win32';
  const executable: string = windows ? `${formatter}.exe` : formatter;
  const fromVenvs: string[] = VENV_FOLDERS.map((folder: string): string =>
    path.join(projectDir, folder, windows ? 'Scripts' : 'bin', executable),
  );
  const userBins: string[] = windows
    ? []
    : [
        path.join(home, '.local', 'bin', executable),
        '/opt/homebrew/bin/' + executable,
        '/usr/local/bin/' + executable,
      ];
  return [...fromVenvs, ...userBins, executable];
}

/**
 * Finds the folder of the project a Python file belongs to: the nearest folder holding a
 * `pyproject.toml`, looking no higher than the workspace root, or the root itself.
 * @param filePath The file's absolute path.
 * @param root The absolute workspace root holding it.
 * @returns Returns the project's folder.
 */
export function pythonProjectDir(filePath: string, root: string): string {
  const top: string = path.resolve(root);
  let folder: string = path.dirname(path.resolve(filePath));
  while (folder === top || folder.startsWith(top + path.sep)) {
    if (existsSync(path.join(folder, 'pyproject.toml'))) {
      return folder;
    }
    if (folder === top) {
      break;
    }
    folder = path.dirname(folder);
  }
  return top;
}

/**
 * Runs a formatter, feeding it the text and collecting what it writes, ended if it outlasts
 * {@link FORMAT_TIMEOUT_MS}.
 * @param executable The executable.
 * @param args Its arguments.
 * @param cwd The folder to run in.
 * @param input The text to format.
 * @returns Returns its exit code and output; rejects when it could not be started.
 */
export const runFormatter: FormatterRunner = (
  executable: string,
  args: readonly string[],
  cwd: string,
  input: string,
) =>
  new Promise((resolve, reject): void => {
    const child: ChildProcessWithoutNullStreams = spawn(executable, [...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout: string = '';
    let stderr: string = '';
    const timer: NodeJS.Timeout = setTimeout((): void => {
      child.kill('SIGKILL');
    }, FORMAT_TIMEOUT_MS);
    child.stdout.setEncoding('utf8').on('data', (chunk: string): void => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string): void => {
      stderr += chunk;
    });
    child.on('error', (error: Error): void => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code: number | null): void => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.on('error', (): void => undefined);
    child.stdin.end(input);
  });

/**
 * Formats a Python document's text with the formatter its project uses (#1212): black where its
 * `pyproject.toml` configures black, ruff otherwise. The text is formatted as the file would be, on
 * standard input, so unsaved edits are formatted and nothing is written to disk.
 * @param filePath The document's absolute path.
 * @param text The document's text.
 * @param root The absolute workspace root holding it.
 * @param run Runs the formatter; the real one by default.
 * @returns Returns the formatted text, or why it could not be formatted.
 */
export async function formatPython(
  filePath: string,
  text: string,
  root: string,
  run: FormatterRunner = runFormatter,
): Promise<DocumentFormatResult> {
  const projectDir: string = pythonProjectDir(filePath, root);
  let pyproject: string | null;
  try {
    pyproject = await fs.readFile(path.join(projectDir, 'pyproject.toml'), 'utf8');
  } catch {
    pyproject = null;
  }
  const formatter: PythonFormatter = pythonFormatterFor(pyproject);
  const args: readonly string[] = formatterArgs(formatter, filePath);
  for (const candidate of formatterCandidates(formatter, projectDir)) {
    // A path is tried only where it exists; the bare name is left to the PATH.
    if (path.isAbsolute(candidate) && !existsSync(candidate)) {
      continue;
    }
    let outcome: Awaited<ReturnType<FormatterRunner>>;
    try {
      outcome = await run(candidate, args, projectDir, text);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        continue;
      }
      logger.warn('PythonFormatter', `Could not run ${candidate}`, error);
      return { text: null, error: `${formatter} could not be run.`, formatter };
    }
    if (outcome.code === 0) {
      return { text: outcome.stdout, error: null, formatter };
    }
    const reason: string = outcome.stderr.trim().split('\n')[0] ?? '';
    return {
      text: null,
      error:
        reason.length > 0 ? `${formatter}: ${reason}` : `${formatter} could not format the file.`,
      formatter,
    };
  }
  return {
    text: null,
    error:
      formatter === 'ruff'
        ? 'Ruff is not installed. Install it in the project (pip install ruff) or on the PATH (pipx install ruff).'
        : 'The project formats with black, which is not installed. Install it in the project (pip install black).',
    formatter,
  };
}
