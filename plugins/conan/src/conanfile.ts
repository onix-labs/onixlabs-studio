// Reads what a Conan project declares: `conanfile.txt`, `conanfile.py` and the `conan.lock` beside them.
//
// `conanfile.txt` is a small INI-like file and is read in full. `conanfile.py` is a Python program, and
// ⛔ it is never run: running it would run whatever the folder's author wrote, merely because the user
// opened the folder. It is read with regular expressions instead, which find the common declarations —
// `requires = …`, `tool_requires = …`, `test_requires = …` and `self.requires("…")`-style calls with a
// literal reference. A requirement built at run time (from a variable, an option or a condition) cannot
// be seen this way and is not listed; nothing pretends otherwise.

import { PackageDependencyScope } from './protocol';

/**
 * Matches a Conan reference: `name/version`, the version a literal or a `[range]`, then the optional
 * `@user/channel` and `#revision`.
 */
const REFERENCE: RegExp =
  /^([A-Za-z0-9_][A-Za-z0-9_+.-]*)\/(\[[^\]]*\]|[^@#\s[\]]+)(?:@[^#\s]*)?(?:#\S*)?$/;

/**
 * How each kind of requirement maps onto the panel's scopes: a library the project links is
 * production; a build tool (`tool_requires`, and the older `build_requires`) and a test framework
 * (`test_requires`) are development.
 */
const SCOPES: Readonly<Record<string, PackageDependencyScope>> = {
  requires: 'production',
  tool_requires: 'development',
  build_requires: 'development',
  test_requires: 'development',
};

/**
 * Matches a class attribute declaring requirements in `conanfile.py`, up to its value.
 */
const ATTRIBUTE: RegExp =
  /^[ \t]*(requires|tool_requires|build_requires|test_requires)[ \t]*=[ \t]*/gm;

/**
 * Matches a method call declaring one requirement with a literal reference in `conanfile.py`.
 */
const CALL: RegExp =
  /self\.(requires|tool_requires|build_requires|test_requires)\(\s*(?:ref\s*=\s*)?(["'])([^"'\n]*)\2/g;

/**
 * Matches one string literal.
 */
const STRING_LITERAL: RegExp = /(["'])([^"'\n]*)\1/g;

/**
 * One parsed reference.
 */
export interface ConanReference {
  /**
   * Gets the package name.
   */
  readonly name: string;

  /**
   * Gets the version, or a version range such as `[>=1.2 <2]`.
   */
  readonly version: string;
}

/**
 * One requirement a conanfile declares.
 */
export interface ConanRequirement extends ConanReference {
  /**
   * Gets the scope it maps onto.
   */
  readonly scope: PackageDependencyScope;
}

/**
 * What a conanfile declares.
 */
export interface Conanfile {
  /**
   * Gets the recipe's own name, or null when it declares none (a `conanfile.txt` never does).
   */
  readonly name: string | null;

  /**
   * Gets the requirements, in the order declared.
   */
  readonly requirements: readonly ConanRequirement[];
}

/**
 * Parses a reference.
 * @param text The reference.
 * @returns Returns the name and version, or null when it is not a reference.
 */
export function parseReference(text: string): ConanReference | null {
  const match: RegExpExecArray | null = REFERENCE.exec(text.trim());
  return match === null ? null : { name: match[1], version: match[2] };
}

/**
 * Determines whether a requested version is one exact version rather than a range.
 * @param version The requested version.
 * @returns Returns true when it is exact.
 */
export function isExactVersion(version: string): boolean {
  return !version.startsWith('[');
}

/**
 * Parses a `conanfile.txt`: the references in its `[requires]`, `[tool_requires]`, `[build_requires]`
 * and `[test_requires]` sections.
 * @param text The file's text.
 * @returns Returns what it declares.
 */
export function parseConanfileTxt(text: string): Conanfile {
  const requirements: ConanRequirement[] = [];
  let scope: PackageDependencyScope | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line: string = raw.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    const section: RegExpExecArray | null = /^\[([A-Za-z_]+)\]$/.exec(line);
    if (section !== null) {
      scope = SCOPES[section[1]] ?? null;
      continue;
    }
    const reference: ConanReference | null = scope === null ? null : parseReference(line);
    if (reference !== null && scope !== null) {
      requirements.push({ ...reference, scope });
    }
  }
  return { name: null, requirements };
}

/**
 * Reads one Python statement's text from where its value starts: up to the end of the line, or past
 * it while a bracket is open, ignoring brackets inside strings (a version range has them).
 * @param text The file's text.
 * @param start Where the value starts.
 * @returns Returns the statement's value.
 */
function statementFrom(text: string, start: number): string {
  let depth: number = 0;
  let quote: string | null = null;
  let index: number = start;
  for (; index < text.length; index += 1) {
    const char: string = text[index];
    if (quote !== null) {
      quote = char === quote || char === '\n' ? null : quote;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(' || char === '[' || char === '{') {
      depth += 1;
    } else if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
    } else if (char === '#') {
      // A comment ends the line, and the statement too unless a bracket is still open.
      const newline: number = text.indexOf('\n', index);
      if (depth === 0 || newline < 0) {
        break;
      }
      index = newline - 1;
    } else if (char === '\n' && depth === 0) {
      break;
    }
  }
  return text.slice(start, index);
}

/**
 * Adds a literal reference to the requirements, unless it is built at run time (an f-string has `{`).
 * @param requirements The requirements so far.
 * @param literal The string literal's content.
 * @param kind The kind of requirement.
 */
function addLiteral(requirements: ConanRequirement[], literal: string, kind: string): void {
  const reference: ConanReference | null = literal.includes('{') ? null : parseReference(literal);
  const scope: PackageDependencyScope | undefined = SCOPES[kind];
  if (reference !== null && scope !== undefined) {
    requirements.push({ ...reference, scope });
  }
}

/**
 * Reads a `conanfile.py` without running it: its `name`, and the requirements it declares with literal
 * references, as class attributes or as calls.
 * @param text The file's text.
 * @returns Returns what it visibly declares.
 */
export function parseConanfilePy(text: string): Conanfile {
  // A commented-out line declares nothing.
  const source: string = text
    .split(/\r?\n/)
    .map((line: string): string => (line.trimStart().startsWith('#') ? '' : line))
    .join('\n');
  const requirements: ConanRequirement[] = [];
  for (const match of source.matchAll(ATTRIBUTE)) {
    const value: string = statementFrom(source, (match.index ?? 0) + match[0].length);
    for (const literal of value.matchAll(STRING_LITERAL)) {
      addLiteral(requirements, literal[2], match[1]);
    }
  }
  for (const match of source.matchAll(CALL)) {
    addLiteral(requirements, match[3], match[1]);
  }
  const name: RegExpExecArray | null = /^[ \t]+name[ \t]*=[ \t]*["']([^"'\n]+)["']/m.exec(source);
  return { name: name === null ? null : name[1], requirements };
}

/**
 * Reads the versions a `conan.lock` resolved, from its `requires`, `build_requires` and
 * `python_requires` lists of locked references.
 * @param lock The parsed lockfile.
 * @param compare Orders two versions.
 * @returns Returns the version by package name; the newest listed when a name is locked twice.
 */
export function parseLock(
  lock: unknown,
  compare: (a: string, b: string) => number,
): ReadonlyMap<string, string> {
  const versions: Map<string, string> = new Map<string, string>();
  if (typeof lock !== 'object' || lock === null) {
    return versions;
  }
  const record: Record<string, unknown> = lock as Record<string, unknown>;
  for (const key of ['requires', 'build_requires', 'python_requires']) {
    const entries: unknown = record[key];
    for (const entry of Array.isArray(entries) ? entries : []) {
      const reference: ConanReference | null =
        typeof entry === 'string' ? parseReference(entry) : null;
      if (reference === null || !isExactVersion(reference.version)) {
        continue;
      }
      const known: string | undefined = versions.get(reference.name);
      if (known === undefined || compare(reference.version, known) > 0) {
        versions.set(reference.name, reference.version);
      }
    }
  }
  return versions;
}
