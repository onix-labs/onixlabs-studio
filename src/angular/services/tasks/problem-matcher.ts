import { DiagnosticSeverity } from '../diagnostics/diagnostics';

/**
 * Describes a single problem extracted from a line of task output by a {@link ProblemMatcher}.
 */
export interface MatchedProblem {
  /**
   * Gets the file path the problem was reported against, as it appeared in the output (which may be
   * relative to the task's working directory).
   */
  readonly file: string;

  /**
   * Gets the 1-based line the problem starts on.
   */
  readonly line: number;

  /**
   * Gets the 1-based column the problem starts on.
   */
  readonly column: number;

  /**
   * Gets the severity of the problem.
   */
  readonly severity: DiagnosticSeverity;

  /**
   * Gets the human-readable message.
   */
  readonly message: string;

  /**
   * Gets the producing source label (for example `typescript` or `gcc`).
   */
  readonly source: string;

  /**
   * Gets the diagnostic code (for example `CS1002`), when the output carried one.
   */
  readonly code?: string;
}

/**
 * Parses a single line of build/compiler output into a {@link MatchedProblem}, or null when the line
 * does not describe a problem. Matchers operate on a single, already ANSI-stripped line.
 */
export interface ProblemMatcher {
  /**
   * Gets the matcher's identifier.
   */
  readonly id: string;

  /**
   * Attempts to extract a problem from a line of output.
   * @param line The output line, with ANSI escapes already removed.
   * @returns Returns the extracted problem, or null when the line does not match.
   */
  match(line: string): MatchedProblem | null;
}

/**
 * Matches the `file(line,col): severity CODE: message` format emitted by the TypeScript compiler and
 * MSBuild (`dotnet build`). A trailing ` [project.csproj]` annotation, which MSBuild appends, is
 * dropped from the message.
 */
const COMPILER_PATTERN: RegExp =
  /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+([A-Za-z]+\d+):\s+(.+?)\s*(?:\[[^\]]*\])?$/;

/**
 * Maps a diagnostic code prefix to the source label it represents.
 */
const SOURCE_BY_CODE_PREFIX: Readonly<Record<string, string>> = {
  TS: 'typescript',
  CS: 'csharp',
  FS: 'fsharp',
  VB: 'vb',
};

/**
 * A matcher for TypeScript- and MSBuild-style compiler diagnostics.
 */
export const COMPILER_MATCHER: ProblemMatcher = {
  id: 'compiler',
  match(line: string): MatchedProblem | null {
    const result: RegExpExecArray | null = COMPILER_PATTERN.exec(line);
    if (result === null) {
      return null;
    }
    const code: string = result[5];
    const prefix: string = /^[A-Za-z]+/.exec(code)?.[0] ?? '';
    return {
      file: result[1],
      line: Number(result[2]),
      column: Number(result[3]),
      severity: result[4] === 'warning' ? 'warning' : 'error',
      message: result[6],
      source: SOURCE_BY_CODE_PREFIX[prefix] ?? 'compiler',
      code,
    };
  },
};

/**
 * Matches the `file:line:col: severity: message` format emitted by GCC, Clang, and many `make`-driven
 * toolchains.
 */
const GCC_PATTERN: RegExp = /^(.+?):(\d+):(\d+):\s+(fatal error|error|warning|note):\s+(.+)$/;

/**
 * A matcher for GCC/Clang-style diagnostics.
 */
export const GCC_MATCHER: ProblemMatcher = {
  id: 'gcc',
  match(line: string): MatchedProblem | null {
    const result: RegExpExecArray | null = GCC_PATTERN.exec(line);
    if (result === null) {
      return null;
    }
    const severityWord: string = result[4];
    return {
      file: result[1],
      line: Number(result[2]),
      column: Number(result[3]),
      severity: severityWord === 'warning' ? 'warning' : severityWord === 'note' ? 'info' : 'error',
      message: result[5],
      source: 'gcc',
    };
  },
};

/**
 * The matchers applied to task output by default.
 */
export const BUILT_IN_MATCHERS: readonly ProblemMatcher[] = [COMPILER_MATCHER, GCC_MATCHER];

/**
 * Removes ANSI escape sequences from a line of output (built without a literal control character so it
 * does not trip the no-control-regex lint rule).
 */
const ANSI_PATTERN: RegExp = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/**
 * Builds a stable key used to de-duplicate identical problems (build tools often repeat them).
 * @param problem The problem to key.
 * @returns Returns the de-duplication key.
 */
function keyOf(problem: MatchedProblem): string {
  return `${problem.file}:${problem.line}:${problem.column}:${problem.message}`;
}

/**
 * Parses build/compiler output into the problems described by the given matchers, removing ANSI
 * escapes and de-duplicating repeated reports.
 * @param text The accumulated output of a task.
 * @param matchers The matchers to apply, in order; the first to match a line wins.
 * @returns Returns the extracted problems in the order first seen.
 */
export function parseProblems(
  text: string,
  matchers: readonly ProblemMatcher[] = BUILT_IN_MATCHERS,
): MatchedProblem[] {
  const seen: Set<string> = new Set<string>();
  const problems: MatchedProblem[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line: string = raw.replace(ANSI_PATTERN, '').trimEnd();
    for (const matcher of matchers) {
      const problem: MatchedProblem | null = matcher.match(line);
      if (problem !== null) {
        const key: string = keyOf(problem);
        if (!seen.has(key)) {
          seen.add(key);
          problems.push(problem);
        }
        break;
      }
    }
  }
  return problems;
}
