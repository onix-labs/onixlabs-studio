import type { Diagnostic } from '@shared/angular/services/diagnostics/diagnostics';
import { groupProblems, OTHER_FILES, ProblemOwner, ProblemProjectGroup } from './problems-grouping';

/**
 * A problem.
 * @param path The file's absolute path, or null for a document with none.
 * @param line Its line.
 * @param severity Its severity.
 * @returns Returns the problem.
 */
function problem(
  path: string | null,
  line: number,
  severity: Diagnostic['severity'] = 'error',
): Diagnostic {
  return {
    file: path?.split(/[\\/]/).pop() ?? 'Untitled-1',
    message: `at ${line}`,
    severity,
    line,
    column: 1,
    source: 'csharp',
    documentId: path === null ? 'doc-9' : null,
    path,
  };
}

const CORE: ProblemOwner = {
  name: 'Core',
  path: 'C:\\ws\\Core\\Core.csproj',
  directory: 'C:\\ws\\Core',
};

describe('groupProblems (#1182)', () => {
  it('groupsByProjectThenFile_inNameAndLineOrder_countingEachSeverity', () => {
    const groups: readonly ProblemProjectGroup[] = groupProblems(
      [
        problem('C:\\ws\\Core\\Sub\\B.cs', 9, 'warning'),
        problem('C:\\ws\\Core\\A.cs', 7),
        problem('C:\\ws\\Core\\A.cs', 2, 'warning'),
        problem('C:\\ws\\loose.cs', 1),
        problem(null, 3),
      ],
      (path: string): ProblemOwner | null => (path.startsWith('C:\\ws\\Core\\') ? CORE : null),
      'C:/ws',
    );

    expect(
      groups.map((group: ProblemProjectGroup): unknown => ({
        name: group.name,
        counts: group.counts,
        files: group.files.map((file): unknown => [
          file.label,
          file.problems.map((entry: Diagnostic): number => entry.line),
        ]),
      })),
    ).toEqual([
      {
        name: 'Core',
        counts: { error: 1, warning: 2, info: 0, hint: 0 },
        files: [
          ['A.cs', [2, 7]],
          ['Sub/B.cs', [9]],
        ],
      },
      {
        name: OTHER_FILES,
        counts: { error: 2, warning: 0, info: 0, hint: 0 },
        files: [
          ['loose.cs', [1]],
          ['Untitled-1', [3]],
        ],
      },
    ]);
  });

  it('aWorkspaceWithNoProjects_isOneGroupOfFiles', () => {
    const groups: readonly ProblemProjectGroup[] = groupProblems(
      [problem('/ws/a.ts', 1), problem('/elsewhere/b.ts', 1)],
      (): null => null,
      null,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe(OTHER_FILES);
    // With no root to name them from, files keep their own names.
    expect(groups[0]?.files.map((file): string => file.label)).toEqual(['a.ts', 'b.ts']);
  });
});
