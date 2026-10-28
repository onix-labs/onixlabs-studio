import type {
  Diagnostic,
  DiagnosticSeverity,
} from '@shared/angular/services/diagnostics/diagnostics';

/**
 * The name the group of problems in files no project holds is shown under.
 */
export const OTHER_FILES: string = 'Other Files';

/**
 * Describes the problems in one file.
 */
export interface ProblemFileGroup {
  /**
   * Gets what identifies the file: its absolute path, or its display name for a document with none.
   */
  readonly key: string;

  /**
   * Gets the file's name as listed: relative to its project, or to the workspace.
   */
  readonly label: string;

  /**
   * Gets its problems, in line order.
   */
  readonly problems: readonly Diagnostic[];
}

/**
 * Describes the problems in one project.
 */
export interface ProblemProjectGroup {
  /**
   * Gets what identifies the project: its project file's path, or {@link OTHER_FILES}.
   */
  readonly key: string;

  /**
   * Gets the project's name, or {@link OTHER_FILES}.
   */
  readonly name: string;

  /**
   * Gets its files, in name order.
   */
  readonly files: readonly ProblemFileGroup[];

  /**
   * Gets how many problems of each severity it has.
   */
  readonly counts: Readonly<Record<DiagnosticSeverity, number>>;
}

/**
 * Describes the project a file belongs to, as the workspace's project model answers it.
 */
export interface ProblemOwner {
  /**
   * Gets the project's name.
   */
  readonly name: string;

  /**
   * Gets the project file's path.
   */
  readonly path: string;

  /**
   * Gets the project's directory.
   */
  readonly directory: string;
}

/**
 * Groups problems by the project that owns each file, then by file (#1182): projects in name order with
 * {@link OTHER_FILES} last, files in name order within each, and each file's problems in line order. A
 * workspace with no projects — nothing owns any file — is one group of files, which the Error List shows
 * without a project level.
 * @param problems The problems.
 * @param ownerOf Finds the project that owns a file, or null.
 * @param root The workspace's root, which a file no project owns is named relative to, or null.
 * @returns Returns the groups.
 */
export function groupProblems(
  problems: readonly Diagnostic[],
  ownerOf: (path: string) => ProblemOwner | null,
  root: string | null,
): readonly ProblemProjectGroup[] {
  const projects: Map<string, { name: string; files: Map<string, ProblemFileGroupDraft> }> =
    new Map<string, { name: string; files: Map<string, ProblemFileGroupDraft> }>();
  for (const problem of problems) {
    const owner: ProblemOwner | null = problem.path === null ? null : ownerOf(problem.path);
    const projectKey: string = owner?.path ?? OTHER_FILES;
    let project: { name: string; files: Map<string, ProblemFileGroupDraft> } | undefined =
      projects.get(projectKey);
    if (project === undefined) {
      project = {
        name: owner?.name ?? OTHER_FILES,
        files: new Map<string, ProblemFileGroupDraft>(),
      };
      projects.set(projectKey, project);
    }
    const fileKey: string = problem.path ?? problem.file;
    let file: ProblemFileGroupDraft | undefined = project.files.get(fileKey);
    if (file === undefined) {
      file = {
        key: fileKey,
        label:
          problem.path === null
            ? problem.file
            : (relativeTo(problem.path, owner?.directory ?? root) ?? problem.file),
        problems: [],
      };
      project.files.set(fileKey, file);
    }
    file.problems.push(problem);
  }
  return [...projects]
    .map(
      ([key, project]: [
        string,
        { name: string; files: Map<string, ProblemFileGroupDraft> },
      ]): ProblemProjectGroup => {
        const files: ProblemFileGroup[] = [...project.files.values()]
          .map((file: ProblemFileGroupDraft): ProblemFileGroup => ({
            key: file.key,
            label: file.label,
            problems: [...file.problems].sort(
              (a: Diagnostic, b: Diagnostic): number => a.line - b.line || a.column - b.column,
            ),
          }))
          .sort((a: ProblemFileGroup, b: ProblemFileGroup): number =>
            a.label.localeCompare(b.label),
          );
        const counts: Record<DiagnosticSeverity, number> = {
          error: 0,
          warning: 0,
          info: 0,
          hint: 0,
        };
        for (const file of files) {
          for (const problem of file.problems) {
            counts[problem.severity]++;
          }
        }
        return { key, name: project.name, files, counts };
      },
    )
    .sort(
      (a: ProblemProjectGroup, b: ProblemProjectGroup): number =>
        Number(a.key === OTHER_FILES) - Number(b.key === OTHER_FILES) ||
        a.name.localeCompare(b.name),
    );
}

/**
 * A file's group while its problems are gathered.
 */
interface ProblemFileGroupDraft {
  readonly key: string;
  readonly label: string;
  readonly problems: Diagnostic[];
}

/**
 * Names a path relative to a directory it is in.
 * @param path The absolute path.
 * @param directory The directory, or null.
 * @returns Returns the relative path, or null when the path is not inside the directory.
 */
function relativeTo(path: string, directory: string | null): string | null {
  if (directory === null) {
    return null;
  }
  const file: string = path.replace(/\\/g, '/');
  const prefix: string = directory.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
  return file.startsWith(prefix) ? file.slice(prefix.length) : null;
}
