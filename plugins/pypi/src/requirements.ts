// Python requirements: one PEP 508 requirement (`requests[socks]>=2.31; python_version >= "3.8"`), and
// pip's requirements files, which hold them one per line among options pip reads itself.
//
// What a requirements file holds that is not a package from an index is skipped, and counted, rather
// than guessed at: an editable install (`-e .`), a URL or a local path is a package the index knows
// nothing about. A `name @ url` direct reference keeps its name, since the project does depend on it,
// but not its URL — ⛔ a URL can carry a user and password, and what is requested goes to the renderer.

import * as path from 'node:path';

/**
 * Says where a requirement comes from: an index, by name and version specifier, or a URL.
 */
export type RequirementKind = 'index' | 'direct';

/**
 * One requirement, read.
 */
export interface Requirement {
  /**
   * Gets the package name, as written.
   */
  readonly name: string;

  /**
   * Gets the version specifier, such as `>=2.31,<3`, `*` when there is none, or `direct reference` for
   * one fetched from a URL.
   */
  readonly requested: string;

  /**
   * Gets where it comes from.
   */
  readonly kind: RequirementKind;
}

/**
 * What a requirements file declares.
 */
export interface RequirementsFile {
  /**
   * Gets the requirements, those of included files with them.
   */
  readonly requirements: readonly Requirement[];

  /**
   * Gets how many lines were skipped as not packages from an index: editables, URLs and paths.
   */
  readonly skipped: number;
}

/**
 * Reads a file's text, or null when it cannot be read.
 */
export type ReadText = (filePath: string) => Promise<string | null>;

/**
 * Says what `requested` is for a requirement with no version specifier: any version.
 */
export const ANY_VERSION: string = '*';

/**
 * Says what `requested` is for a direct reference, whose URL is not shown.
 */
export const DIRECT_REFERENCE: string = 'direct reference';

/**
 * Matches a package name as PEP 508 allows one.
 */
const NAME: RegExp = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/**
 * Bounds how deep `-r` includes are followed, so a chain cannot run on.
 */
const MAX_INCLUDE_DEPTH: number = 8;

/**
 * Normalises a package name as PEP 503 does, so `Foo_Bar`, `foo-bar` and `foo.bar` are one package.
 * @param name The name.
 * @returns Returns the normalised name.
 */
export function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/**
 * Determines whether a name is a package name PEP 508 allows.
 * @param name The candidate.
 * @returns Returns true when it is one.
 */
export function isPackageName(name: string): boolean {
  return NAME.test(name);
}

/**
 * Reads one PEP 508 requirement. The environment marker after `;` is dropped: it says when the
 * requirement applies, not what it asks for.
 * @param text The requirement.
 * @returns Returns the requirement, or null when it is not one.
 */
export function parseRequirement(text: string): Requirement | null {
  const match: RegExpExecArray | null =
    /^\s*([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\s*(\[[^\]]*\])?\s*(.*)$/.exec(text);
  if (match === null) {
    return null;
  }
  const name: string = match[1];
  const rest: string = match[3].trim();
  if (rest.startsWith('@')) {
    return { name, requested: DIRECT_REFERENCE, kind: 'direct' };
  }
  let specifier: string = rest.split(';', 1)[0].trim();
  if (specifier.startsWith('(') && specifier.endsWith(')')) {
    specifier = specifier.slice(1, -1).trim();
  }
  if (specifier.length > 0 && !/^[<>=!~]/.test(specifier)) {
    return null;
  }
  return {
    name,
    requested: specifier.length === 0 ? ANY_VERSION : specifier.replace(/\s+/g, ''),
    kind: 'index',
  };
}

/**
 * Reads a requirements file, following its `-r` includes. Includes outside the root are not read: a
 * project file has no business pointing the plugin at the rest of the disk.
 * @param filePath The absolute path of the file.
 * @param root The absolute folder the request names.
 * @param readText Reads a file.
 * @returns Returns what it declares, or null when it cannot be read.
 */
export async function readRequirementsFile(
  filePath: string,
  root: string,
  readText: ReadText,
): Promise<RequirementsFile | null> {
  const text: string | null = await readText(filePath);
  if (text === null) {
    return null;
  }
  const requirements: Requirement[] = [];
  const counter: { skipped: number } = { skipped: 0 };
  await readLines(
    text,
    filePath,
    root,
    readText,
    new Set<string>([filePath]),
    0,
    requirements,
    counter,
  );
  return { requirements, skipped: counter.skipped };
}

/**
 * Reads the lines of one requirements file into a list, following its includes.
 * @param text The file's text.
 * @param filePath The file's absolute path.
 * @param root The absolute folder includes must stay within.
 * @param readText Reads a file.
 * @param visited The files already read, so a cycle of includes ends.
 * @param depth How deep in includes this file is.
 * @param into The list requirements are added to.
 * @param counter Counts the lines skipped.
 */
async function readLines(
  text: string,
  filePath: string,
  root: string,
  readText: ReadText,
  visited: Set<string>,
  depth: number,
  into: Requirement[],
  counter: { skipped: number },
): Promise<void> {
  for (const line of logicalLines(text)) {
    if (line.startsWith('-')) {
      const include: string | null = includeOf(line);
      if (include !== null) {
        await readInclude(include, filePath, root, readText, visited, depth, into, counter);
      } else if (/^(-e|--editable)\b/.test(line)) {
        counter.skipped += 1;
      }
      // Every other option (`-i`, `--extra-index-url`, `-c`, `--hash` on its own line, …) is pip's, not
      // a package. ⛔ An index a project file names is not followed: it would point the plugin's
      // lookups, and any credential, wherever the project chose.
      continue;
    }
    if (looksLikeLocation(line)) {
      counter.skipped += 1;
      continue;
    }
    // A requirement may carry per-requirement options after it, such as `--hash=sha256:…`.
    const requirement: Requirement | null = parseRequirement(line.replace(/\s+--?[A-Za-z].*$/, ''));
    if (requirement === null) {
      counter.skipped += 1;
    } else {
      into.push(requirement);
    }
  }
}

/**
 * Follows one `-r` include, when it is a file within the root that has not been read yet.
 * @param include The included path, as written.
 * @param from The absolute path of the including file.
 * @param root The absolute folder includes must stay within.
 * @param readText Reads a file.
 * @param visited The files already read.
 * @param depth How deep in includes the including file is.
 * @param into The list requirements are added to.
 * @param counter Counts the lines skipped.
 */
async function readInclude(
  include: string,
  from: string,
  root: string,
  readText: ReadText,
  visited: Set<string>,
  depth: number,
  into: Requirement[],
  counter: { skipped: number },
): Promise<void> {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(include) || depth + 1 > MAX_INCLUDE_DEPTH) {
    counter.skipped += 1;
    return;
  }
  const target: string = path.resolve(path.dirname(from), include);
  if (!(target === root || target.startsWith(root + path.sep)) || visited.has(target)) {
    return;
  }
  visited.add(target);
  const text: string | null = await readText(target);
  if (text !== null) {
    await readLines(text, target, root, readText, visited, depth + 1, into, counter);
  }
}

/**
 * Reads the file an option line includes, `-r other.txt` or `--requirement=other.txt`.
 * @param line The line.
 * @returns Returns the path, or null when the line includes nothing.
 */
function includeOf(line: string): string | null {
  const match: RegExpExecArray | null = /^(?:-r\s*|--requirement(?:\s*=\s*|\s+))(\S+)/.exec(line);
  return match === null ? null : match[1];
}

/**
 * Determines whether a line names a location rather than a package: a URL, an archive or a path.
 * @param line The line.
 * @returns Returns true when it does.
 */
function looksLikeLocation(line: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:(\/\/|[^ ]*@)/i.test(line) ||
    /^[./\\~]/.test(line) ||
    /^[A-Za-z]:[\\/]/.test(line) ||
    /\.(whl|zip|tar\.gz|tar\.bz2|tgz)$/i.test(line.split(/\s/, 1)[0])
  );
}

/**
 * Splits a requirements file into its logical lines: continuations joined, comments and blank lines
 * dropped. A `#` starts a comment at the start of a line or after whitespace, as pip reads it.
 * @param text The file's text.
 * @returns Returns the lines, trimmed.
 */
function logicalLines(text: string): readonly string[] {
  const joined: string = text.replace(/^\uFEFF/, '').replace(/\\\r?\n/g, ' ');
  return joined
    .split(/\r?\n/)
    .map((line: string): string => line.replace(/(^|\s)#.*$/, '').trim())
    .filter((line: string): boolean => line.length > 0);
}
