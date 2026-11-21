import { globToRegExp } from '@shared/api/lsp-glob';

/**
 * One of the user's own file associations (#1068): files matching {@link pattern} open in
 * {@link language}, whatever Studio's built-in rules would say.
 *
 * The pattern is a file name (`Jenkinsfile`), a wildcard pattern over a file's name (`*.foo`,
 * `*.config.js`), or — when it holds a path separator — a path or a pattern over the whole path
 * (`/Users/me/notes/todo.txt`, `/work/ci/*.yml`). `*` stands for any run of characters within one
 * segment, `**` for any number of segments, `?` for one character, `{a,b}` for either. Matching ignores
 * case, as the built-in names do.
 */
export interface FileAssociation {
  /**
   * Gets the file name, path or pattern the association applies to.
   */
  readonly pattern: string;

  /**
   * Gets the Monaco language identifier matching files open in.
   */
  readonly language: string;
}

/**
 * Names what a pattern matches, which decides where it stands in the resolver's order: an exact entry
 * beats a pattern, and one over the whole path beats one over the name, since each is the more
 * specific claim.
 */
enum PatternKind {
  ExactPath = 'exact-path',
  ExactName = 'exact-name',
  PathGlob = 'path-glob',
  NameGlob = 'name-glob',
}

/**
 * An association made ready to match.
 */
interface CompiledAssociation {
  /**
   * Gets what the pattern matches.
   */
  readonly kind: PatternKind;

  /**
   * Gets the pattern, trimmed, forward-slashed and lower-cased, for an exact entry's comparison and a
   * glob's length.
   */
  readonly pattern: string;

  /**
   * Gets the expression a glob matches, or undefined for an exact entry.
   */
  readonly expression: RegExp | undefined;

  /**
   * Gets the language.
   */
  readonly language: string;
}

/**
 * The order the kinds are tried in.
 */
const KIND_ORDER: readonly PatternKind[] = [
  PatternKind.ExactPath,
  PatternKind.ExactName,
  PatternKind.PathGlob,
  PatternKind.NameGlob,
];

/**
 * Holds each association list compiled, so the resolver, run for every file opened, compiles a list
 * once rather than per file.
 */
const COMPILED: WeakMap<readonly FileAssociation[], readonly CompiledAssociation[]> = new WeakMap<
  readonly FileAssociation[],
  readonly CompiledAssociation[]
>();

/**
 * Reads the associations from a setting's value, keeping the well-formed ones: the value is the
 * user's, and may have been imported from a file.
 * @param value The setting's value.
 * @returns Returns the associations.
 */
export function fileAssociations(value: unknown): readonly FileAssociation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry: unknown): entry is FileAssociation =>
      typeof entry === 'object' &&
      entry !== null &&
      'pattern' in entry &&
      'language' in entry &&
      typeof entry.pattern === 'string' &&
      typeof entry.language === 'string' &&
      entry.pattern.trim().length > 0 &&
      entry.language.trim().length > 0,
  );
}

/**
 * Finds the language the user's own associations give a file, the first step of the resolver
 * ({@link import('./monaco-languages').languageForFileName}).
 *
 * The most specific entry wins: an exact path, then an exact name, then a pattern over the path, then
 * a pattern over the name. Between two patterns of the same kind the longer — the one that says more
 * about the file — wins, and between two as long, the one listed first.
 * @param fileName The file's path, or its name when it has no path yet.
 * @param associations The user's associations.
 * @returns Returns the language, or undefined when no association matches.
 */
export function associatedLanguage(
  fileName: string,
  associations: readonly FileAssociation[],
): string | undefined {
  if (associations.length === 0) {
    return undefined;
  }
  const path: string = fileName.replace(/\\/g, '/').toLowerCase();
  const name: string = path.split('/').pop() ?? '';
  const compiled: readonly CompiledAssociation[] = compile(associations);
  for (const kind of KIND_ORDER) {
    let best: CompiledAssociation | undefined;
    for (const association of compiled) {
      if (association.kind !== kind || !matches(association, path, name)) {
        continue;
      }
      if (best === undefined || association.pattern.length > best.pattern.length) {
        best = association;
      }
    }
    if (best !== undefined) {
      return best.language;
    }
  }
  return undefined;
}

/**
 * Adds an association, replacing any entry for the same pattern, so a pattern is never answered by
 * two languages.
 * @param associations The associations as they stand.
 * @param association The association to add.
 * @returns Returns the new list, with the association last.
 */
export function withFileAssociation(
  associations: readonly FileAssociation[],
  association: FileAssociation,
): readonly FileAssociation[] {
  const pattern: string = association.pattern.trim();
  return [
    ...associations.filter(
      (existing: FileAssociation): boolean => !samePattern(existing.pattern, pattern),
    ),
    { pattern, language: association.language },
  ];
}

/**
 * Removes the entry for a pattern.
 * @param associations The associations as they stand.
 * @param pattern The pattern whose entry goes.
 * @returns Returns the new list.
 */
export function withoutFileAssociation(
  associations: readonly FileAssociation[],
  pattern: string,
): readonly FileAssociation[] {
  return associations.filter(
    (existing: FileAssociation): boolean => !samePattern(existing.pattern, pattern),
  );
}

/**
 * Gets the pattern that stands for every file sharing a file's ending, such as `*.foo` for
 * `notes.foo`.
 * @param fileName The file's path or name.
 * @returns Returns the pattern, or undefined for a name with no ending (`Jenkinsfile`, `.gitignore`).
 */
export function extensionPattern(fileName: string): string | undefined {
  const name: string = fileName.split(/[\\/]/).pop() ?? '';
  const dot: number = name.lastIndexOf('.');
  // A leading dot is the whole name of a dotfile, not an ending, as the built-in rules read it.
  return dot <= 0 || dot === name.length - 1 ? undefined : `*${name.slice(dot).toLowerCase()}`;
}

/**
 * Determines whether two patterns are the same entry: the same once trimmed, slashes aside, without
 * regard to case — the way they match.
 * @param left One pattern.
 * @param right The other.
 * @returns Returns true when they are the same.
 */
function samePattern(left: string, right: string): boolean {
  return normalise(left) === normalise(right);
}

/**
 * Normalises a pattern for comparison and matching.
 * @param pattern The pattern.
 * @returns Returns it trimmed, forward-slashed and lower-cased.
 */
function normalise(pattern: string): string {
  return pattern.trim().replace(/\\/g, '/').toLowerCase();
}

/**
 * Compiles an association list, once per list.
 * @param associations The associations.
 * @returns Returns the compiled associations, in the order given.
 */
function compile(associations: readonly FileAssociation[]): readonly CompiledAssociation[] {
  const cached: readonly CompiledAssociation[] | undefined = COMPILED.get(associations);
  if (cached !== undefined) {
    return cached;
  }
  const compiled: readonly CompiledAssociation[] = associations.map(
    (association: FileAssociation): CompiledAssociation => {
      const pattern: string = normalise(association.pattern);
      const isPath: boolean = pattern.includes('/');
      const isGlob: boolean = /[*?[{]/.test(pattern);
      return {
        kind: isGlob
          ? isPath
            ? PatternKind.PathGlob
            : PatternKind.NameGlob
          : isPath
            ? PatternKind.ExactPath
            : PatternKind.ExactName,
        pattern,
        expression: isGlob ? new RegExp(globToRegExp(pattern).source, 'i') : undefined,
        language: association.language.trim(),
      };
    },
  );
  COMPILED.set(associations, compiled);
  return compiled;
}

/**
 * Determines whether a compiled association matches a file.
 * @param association The association.
 * @param path The file's path, forward-slashed and lower-cased.
 * @param name The file's name, lower-cased.
 * @returns Returns true when it matches.
 */
function matches(association: CompiledAssociation, path: string, name: string): boolean {
  switch (association.kind) {
    case PatternKind.ExactPath:
      return path === association.pattern;
    case PatternKind.ExactName:
      return name === association.pattern;
    case PatternKind.PathGlob:
      return association.expression?.test(path) === true;
    case PatternKind.NameGlob:
      return association.expression?.test(name) === true;
  }
}
