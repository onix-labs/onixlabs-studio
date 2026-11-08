// Reads what a Python project declares, from each of the files a project can declare it in:
// `pyproject.toml` (PEP 621's `[project]`, PEP 735's `[dependency-groups]`, uv's and Poetry's own
// tables), `Pipfile`, `setup.cfg`, and the literal parts of `setup.py`.
//
// Scopes map onto Studio's four: what a project needs to run is `production`; an extra
// (`[project.optional-dependencies]`, a Poetry dependency marked `optional`, `setup.cfg`'s
// `extras_require`) is `optional`; a dependency group (PEP 735, Poetry groups, uv's and Poetry's old
// dev tables, Pipfile's `[dev-packages]`) is `development`. Python has no peer dependencies.
//
// ⛔ `setup.py` is a program. It is never run: only a literal `install_requires = [...]` list of plain
// strings is read out of it, and anything else in that list means it is not read at all.

import {
  ANY_VERSION,
  DIRECT_REFERENCE,
  normaliseName,
  parseRequirement,
  Requirement,
} from './requirements';
import { IniDocument, parseIni, valueLines } from './ini';
import { PackageDependencyScope } from './protocol';
import { asString, asTable, parseToml, TomlTable, TomlValue } from './toml';

/**
 * Says where in its manifest a package is declared, which is what a write needs to name to keep it
 * there: the project's own dependencies, an extra, or a dependency group.
 */
export type Placement =
  | { readonly kind: 'main' }
  | { readonly kind: 'optional'; readonly extra: string | null }
  | { readonly kind: 'group'; readonly group: string };

/**
 * A package a manifest declares.
 */
export interface DeclaredPackage {
  /**
   * Gets the package name, as written.
   */
  readonly name: string;

  /**
   * Gets what is requested: a version specifier, `*`, or `direct reference`.
   */
  readonly requested: string;

  /**
   * Gets whether it comes from an index, so has a latest version to look up.
   */
  readonly fromIndex: boolean;

  /**
   * Gets where it is declared.
   */
  readonly placement: Placement;
}

/**
 * What a `pyproject.toml` says.
 */
export interface Pyproject {
  /**
   * Gets the project's name, or null when it names none.
   */
  readonly name: string | null;

  /**
   * Gets the packages it declares.
   */
  readonly packages: readonly DeclaredPackage[];

  /**
   * Gets whether it has a `[tool.uv]` table.
   */
  readonly usesUv: boolean;

  /**
   * Gets whether it has a `[tool.poetry]` table.
   */
  readonly usesPoetry: boolean;
}

/**
 * The place a project's own dependencies are declared.
 */
const MAIN: Placement = { kind: 'main' };

/**
 * Maps where a package is declared onto Studio's scopes.
 * @param placement Where it is declared.
 * @returns Returns the scope.
 */
export function scopeOf(placement: Placement): PackageDependencyScope {
  switch (placement.kind) {
    case 'main':
      return 'production';
    case 'optional':
      return 'optional';
    default:
      return 'development';
  }
}

/**
 * Reads a `pyproject.toml`.
 * @param text The file's text.
 * @returns Returns what it says, or null when it is not TOML this plugin can read.
 */
export function readPyproject(text: string): Pyproject | null {
  const toml: TomlTable | null = parseToml(text);
  if (toml === null) {
    return null;
  }
  const project: TomlTable | null = asTable(toml['project']);
  const tool: TomlTable | null = asTable(toml['tool']);
  const uv: TomlTable | null = asTable(tool?.['uv']);
  const poetry: TomlTable | null = asTable(tool?.['poetry']);
  const packages: DeclaredPackage[] = [];

  packages.push(...pep508List(project?.['dependencies'], MAIN));
  for (const [extra, list] of Object.entries(asTable(project?.['optional-dependencies']) ?? {})) {
    packages.push(...pep508List(list, { kind: 'optional', extra }));
  }
  for (const [group, list] of Object.entries(asTable(toml['dependency-groups']) ?? {})) {
    packages.push(...pep508List(list, { kind: 'group', group }));
  }
  packages.push(...pep508List(uv?.['dev-dependencies'], { kind: 'group', group: 'dev' }));

  if (poetry !== null) {
    packages.push(...poetryTable(poetry['dependencies'], MAIN));
    packages.push(...poetryTable(poetry['dev-dependencies'], { kind: 'group', group: 'dev' }));
    for (const [group, body] of Object.entries(asTable(poetry['group']) ?? {})) {
      packages.push(...poetryTable(asTable(body)?.['dependencies'], { kind: 'group', group }));
    }
  }

  const name: string | null = asString(project?.['name']) ?? asString(poetry?.['name']);
  return { name, packages: unique(packages), usesUv: uv !== null, usesPoetry: poetry !== null };
}

/**
 * Reads a `Pipfile`: `[packages]` and `[dev-packages]`.
 * @param text The file's text.
 * @returns Returns the packages, or null when it is not TOML this plugin can read.
 */
export function readPipfile(text: string): readonly DeclaredPackage[] | null {
  const toml: TomlTable | null = parseToml(text);
  if (toml === null) {
    return null;
  }
  return unique([
    ...tableOfSpecs(toml['packages'], MAIN),
    ...tableOfSpecs(toml['dev-packages'], { kind: 'group', group: 'dev' }),
  ]);
}

/**
 * Reads a `setup.cfg`: `[options] install_requires` and `[options.extras_require]`.
 * @param text The file's text.
 * @returns Returns the packages.
 */
export function readSetupCfg(text: string): readonly DeclaredPackage[] {
  const ini: IniDocument = parseIni(text);
  const packages: DeclaredPackage[] = [];
  for (const line of valueLines(ini.get('options')?.get('install_requires'))) {
    packages.push(...pep508List([line], MAIN));
  }
  for (const [extra, value] of ini.get('options.extras_require') ?? new Map<string, string>()) {
    packages.push(...pep508List([...valueLines(value)], { kind: 'optional', extra }));
  }
  return unique(packages);
}

/**
 * Reads the literal `install_requires` list out of a `setup.py`, without running it.
 * @param text The file's text.
 * @returns Returns the packages, or none when the list is absent or is anything but plain strings.
 */
export function readSetupPy(text: string): readonly DeclaredPackage[] {
  const start: RegExpExecArray | null = /\binstall_requires\s*=\s*\[/.exec(text);
  if (start === null) {
    return [];
  }
  // Each step is blank space and comments, then a plain string and a comma, or the closing bracket.
  // Anything else — a variable, a call, a string with escapes — and the list is not read at all,
  // rather than read in part.
  const item: RegExp = /(?:\s|#[^\n]*)*(?:"([^"\\\n]*)"|'([^'\\\n]*)'|(\]))(?:\s|#[^\n]*)*(,)?/y;
  const strings: string[] = [];
  item.lastIndex = start.index + start[0].length;
  for (;;) {
    const match: RegExpExecArray | null = item.exec(text);
    if (match === null) {
      return [];
    }
    if (match[3] !== undefined) {
      // The list must be the whole value: `[...] + EXTRA` is not a literal.
      return match[4] !== undefined || /^\s*\)/.test(text.slice(item.lastIndex))
        ? unique(pep508List(strings, MAIN))
        : [];
    }
    strings.push(match[1] ?? match[2]);
    if (match[4] === undefined) {
      // No comma: the next thing must be the closing bracket.
      const close: RegExpExecArray | null = /(?:\s|#[^\n]*)*\]/y.exec(text.slice(item.lastIndex));
      if (close === null) {
        return [];
      }
      item.lastIndex += close[0].length;
      return /^\s*[,)]/.test(text.slice(item.lastIndex)) ? unique(pep508List(strings, MAIN)) : [];
    }
  }
}

/**
 * Reads a list of PEP 508 requirement strings. Anything else in the list (PEP 735's
 * `{ include-group = … }`, which repeats another group) is passed over.
 * @param value The list.
 * @param placement Where the list is.
 * @returns Returns the packages.
 */
function pep508List(
  value: TomlValue | undefined | readonly string[],
  placement: Placement,
): DeclaredPackage[] {
  const packages: DeclaredPackage[] = [];
  for (const item of Array.isArray(value) ? (value as readonly unknown[]) : []) {
    const requirement: Requirement | null =
      typeof item === 'string' ? parseRequirement(item) : null;
    if (requirement !== null) {
      packages.push({
        name: requirement.name,
        requested: requirement.requested,
        fromIndex: requirement.kind === 'index',
        placement,
      });
    }
  }
  return packages;
}

/**
 * Reads one of Poetry's dependency tables, where a value is a constraint (`"^2.31"`), a table
 * (`{ version = "^2.31", optional = true }`, or `{ git = … }` for one not from an index), or a list
 * of tables, one per environment. `python` is the interpreter, not a package.
 * @param value The table.
 * @param placement Where the table is.
 * @returns Returns the packages.
 */
function poetryTable(value: TomlValue | undefined, placement: Placement): DeclaredPackage[] {
  const packages: DeclaredPackage[] = [];
  for (const [name, spec] of Object.entries(asTable(value) ?? {})) {
    if (name.toLowerCase() === 'python') {
      continue;
    }
    const tables: readonly TomlTable[] = Array.isArray(spec)
      ? spec.map(asTable).filter((table: TomlTable | null): table is TomlTable => table !== null)
      : [];
    const first: TomlTable | null = asTable(spec) ?? tables[0] ?? null;
    const optional: boolean = first?.['optional'] === true;
    packages.push({
      ...specOf(name, spec),
      placement:
        optional && placement.kind === 'main' ? { kind: 'optional', extra: null } : placement,
    });
  }
  return packages;
}

/**
 * Reads a table of name-to-spec entries in Pipfile's form, which is Poetry's less the `python` entry.
 * @param value The table.
 * @param placement Where the table is.
 * @returns Returns the packages.
 */
function tableOfSpecs(value: TomlValue | undefined, placement: Placement): DeclaredPackage[] {
  return Object.entries(asTable(value) ?? {}).map(
    ([name, spec]: [string, TomlValue]): DeclaredPackage => ({ ...specOf(name, spec), placement }),
  );
}

/**
 * Reads what a Poetry- or Pipfile-style entry requests.
 * @param name The package name.
 * @param spec The entry's value.
 * @returns Returns the package, less where it is declared.
 */
function specOf(name: string, spec: TomlValue): Omit<DeclaredPackage, 'placement'> {
  if (typeof spec === 'string') {
    return {
      name,
      requested: spec.trim().length === 0 ? ANY_VERSION : spec.trim(),
      fromIndex: true,
    };
  }
  const tables: readonly TomlTable[] = Array.isArray(spec)
    ? spec.map(asTable).filter((table: TomlTable | null): table is TomlTable => table !== null)
    : [asTable(spec)].filter((table: TomlTable | null): table is TomlTable => table !== null);
  if (
    tables.some((table: TomlTable): boolean =>
      ['git', 'path', 'url', 'file'].some((key: string): boolean => key in table),
    )
  ) {
    return { name, requested: DIRECT_REFERENCE, fromIndex: false };
  }
  const versions: readonly string[] = tables
    .map((table: TomlTable): string | null => asString(table['version']))
    .filter((version: string | null): version is string => version !== null);
  return {
    name,
    requested: versions.length === 0 ? ANY_VERSION : versions.join(' || '),
    fromIndex: true,
  };
}

/**
 * Keeps the first of each package declared twice in one place, as one under two environment markers
 * is: it is one dependency to the panel.
 * @param packages The packages.
 * @returns Returns them, each once per placement.
 */
function unique(packages: readonly DeclaredPackage[]): DeclaredPackage[] {
  const seen: Set<string> = new Set<string>();
  return packages.filter((declared: DeclaredPackage): boolean => {
    const key: string = `${normaliseName(declared.name)} ${JSON.stringify(declared.placement)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
