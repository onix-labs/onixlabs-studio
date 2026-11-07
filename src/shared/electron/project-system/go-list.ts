import * as path from 'node:path';
import { ProjectItemNode } from '@shared/api/project-system';
import { buildItemTree, EvaluatedItem } from './item-tree';

/**
 * The fields of a package's `go list -json` record that name the files it is made of: every source the
 * toolchain sorted, those a build constraint leaves out on this machine included (`x_windows.go` is
 * still the project's), its tests, and what `//go:embed` pulls in.
 */
const FILE_FIELDS: readonly string[] = [
  'GoFiles',
  'CgoFiles',
  'IgnoredGoFiles',
  'IgnoredOtherFiles',
  'InvalidGoFiles',
  'CFiles',
  'CXXFiles',
  'MFiles',
  'HFiles',
  'FFiles',
  'SFiles',
  'SwigFiles',
  'SwigCXXFiles',
  'SysoFiles',
  'TestGoFiles',
  'XTestGoFiles',
  'EmbedFiles',
  'TestEmbedFiles',
  'XTestEmbedFiles',
];

/**
 * The arguments that ask `go list` what a module is made of.
 *
 * `-find` stops at each package's own files: nothing is resolved, so nothing is downloaded and a
 * missing dependency is no obstacle. `-e` keeps a package with a syntax error in the answer, because a
 * file mid-edit is still part of the project. `-C` must be the first flag, and is why the process is
 * not given the module as its working directory: on Windows a process is looked for in its working
 * directory first, which would run a `go.exe` the workspace happened to hold.
 * @param moduleDirectory The module's directory.
 * @returns Returns the arguments.
 */
export function goListArguments(moduleDirectory: string): readonly string[] {
  return [
    'list',
    '-C',
    moduleDirectory,
    '-e',
    '-find',
    `-json=Dir,${FILE_FIELDS.join(',')}`,
    './...',
  ];
}

/**
 * A package as `go list` reports it.
 */
export interface GoPackage {
  /**
   * Gets the package's absolute directory.
   */
  readonly directory: string;

  /**
   * Gets the package's files, relative to its directory.
   */
  readonly files: readonly string[];
}

/**
 * Splits a stream of concatenated JSON objects, which is how `go list -json` writes its packages:
 * neither an array nor one object per line.
 * @param stream The output.
 * @returns Returns the text of each top-level object.
 */
function splitJsonObjects(stream: string): readonly string[] {
  const objects: string[] = [];
  let depth: number = 0;
  let start: number = 0;
  let inString: boolean = false;
  for (let index: number = 0; index < stream.length; index += 1) {
    const character: string = stream[index];
    if (inString) {
      if (character === '\\') {
        index += 1;
      } else if (character === '"') {
        inString = false;
      }
    } else if (character === '"') {
      inString = true;
    } else if (character === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        objects.push(stream.slice(start, index + 1));
      }
    }
  }
  return objects;
}

/**
 * Reads the packages out of `go list -json`'s output.
 * @param stream The output.
 * @returns Returns the packages, or null when the output is not what `go list` writes.
 */
export function parseGoPackages(stream: string): readonly GoPackage[] | null {
  const packages: GoPackage[] = [];
  try {
    for (const text of splitJsonObjects(stream)) {
      const record: Record<string, unknown> = JSON.parse(text) as Record<string, unknown>;
      const directory: unknown = record['Dir'];
      if (typeof directory !== 'string') {
        return null;
      }
      const files: string[] = FILE_FIELDS.flatMap((field: string): string[] => {
        const value: unknown = record[field];
        return Array.isArray(value)
          ? value.filter((file: unknown): file is string => typeof file === 'string')
          : [];
      });
      packages.push({ directory, files });
    }
  } catch {
    return null;
  }
  return packages;
}

/**
 * Builds a module's contents from its packages. A Go package is a directory, so the folders of the tree
 * are the packages themselves; they stay real folders, which is also what lets a file be added to one.
 * @param projectPath The absolute path of the module's `go.mod`.
 * @param moduleDirectory The directory `go list` ran in, which the packages' directories are under. Not
 * always the project's own spelling of it: the toolchain answers with the resolved path.
 * @param packages The packages.
 * @param moduleFiles The module's own files (`go.mod`, `go.sum`), relative to its directory.
 * @returns Returns the contents tree.
 */
export function buildGoPackageTree(
  projectPath: string,
  moduleDirectory: string,
  packages: readonly GoPackage[],
  moduleFiles: readonly string[],
): readonly ProjectItemNode[] {
  const items: EvaluatedItem[] = packages.flatMap((entry: GoPackage): EvaluatedItem[] =>
    entry.files.map((file: string): EvaluatedItem => ({
      identity: path.relative(moduleDirectory, path.join(entry.directory, file)),
      link: '',
    })),
  );
  return buildItemTree(projectPath, [
    ...items,
    ...moduleFiles.map((file: string): EvaluatedItem => ({ identity: file, link: '' })),
  ]);
}
