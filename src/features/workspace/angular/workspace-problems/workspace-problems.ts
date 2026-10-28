import { computed, inject, Service, Signal } from '@angular/core';
import { DiagnosticSeverity, Diagnostics } from '@shared/angular/services/diagnostics/diagnostics';

/**
 * Holds, for one severity, the files with problems of it and every folder above them.
 */
interface SeverityPaths {
  /**
   * Holds the normalised paths of the files with problems of the severity.
   */
  readonly files: ReadonlySet<string>;

  /**
   * Holds the normalised paths of every folder above one of those files.
   */
  readonly folders: ReadonlySet<string>;
}

/**
 * Says where a workspace's problems are, for its explorers: which files have errors, warnings, info
 * or hints, and which folders lead to them — as {@link import('../workspace-git/workspace-git').WorkspaceGit}
 * says where its changes are. The explorers draw an error's file, and every folder up to the root,
 * with a red squiggle, and narrow their trees to the files with the problems ticked in their filter.
 *
 * Scoped per directory tab (provided by the directory view), beside the tab's {@link Diagnostics}.
 */
@Service()
export class WorkspaceProblems {
  /**
   * Holds the workspace's diagnostics.
   */
  private readonly diagnostics: Diagnostics = inject(Diagnostics);

  /**
   * Gets each severity's files and the folders above them.
   */
  private readonly bySeverity: Signal<ReadonlyMap<DiagnosticSeverity, SeverityPaths>> = computed(
    (): ReadonlyMap<DiagnosticSeverity, SeverityPaths> => {
      const found: Map<DiagnosticSeverity, { files: Set<string>; folders: Set<string> }> = new Map<
        DiagnosticSeverity,
        { files: Set<string>; folders: Set<string> }
      >();
      for (const diagnostic of this.diagnostics.all()) {
        if (diagnostic.path === null) {
          continue;
        }
        let paths: { files: Set<string>; folders: Set<string> } | undefined = found.get(
          diagnostic.severity,
        );
        if (paths === undefined) {
          paths = { files: new Set<string>(), folders: new Set<string>() };
          found.set(diagnostic.severity, paths);
        }
        const file: string = normalize(diagnostic.path);
        if (paths.files.has(file)) {
          continue;
        }
        paths.files.add(file);
        addFolders(file, paths.folders);
      }
      return found;
    },
  );

  /**
   * Determines whether a file has problems of a severity, or a folder leads to one that does.
   * @param path The file's or folder's absolute path.
   * @param severity The severity.
   * @returns Returns true when it does.
   */
  public has(path: string, severity: DiagnosticSeverity): boolean {
    const paths: SeverityPaths | undefined = this.bySeverity().get(severity);
    if (paths === undefined) {
      return false;
    }
    const key: string = normalize(path);
    return paths.files.has(key) || paths.folders.has(key);
  }

  /**
   * Determines whether a file has problems of a severity of its own — not a folder leading to one.
   * @param path The file's absolute path.
   * @param severity The severity.
   * @returns Returns true when it does.
   */
  public inFile(path: string, severity: DiagnosticSeverity): boolean {
    return this.bySeverity().get(severity)?.files.has(normalize(path)) === true;
  }
}

/**
 * Normalises a path for comparison: forward slashes, and no trailing slash.
 * @param value The path.
 * @returns Returns it normalised.
 */
function normalize(value: string): string {
  const slashed: string = value.replace(/\\/g, '/');
  return slashed.length > 1 && slashed.endsWith('/') ? slashed.slice(0, -1) : slashed;
}

/**
 * Adds every folder above a file, to the filesystem's root.
 * @param file The file's normalised path.
 * @param folders The set to add them to.
 */
function addFolders(file: string, folders: Set<string>): void {
  let current: string = file;
  for (;;) {
    const slash: number = current.lastIndexOf('/');
    if (slash <= 0) {
      return;
    }
    current = current.slice(0, slash);
    if (folders.has(current)) {
      // Everything above it was added with it.
      return;
    }
    folders.add(current);
  }
}
