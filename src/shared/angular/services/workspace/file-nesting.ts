/**
 * One File Nesting rule: the files named like {@link parent} gather, beneath them in an explorer, the
 * files beside them named like {@link children} — the parts of a partial class under the class's own
 * file, a code-behind under its markup.
 *
 * Both are wildcard patterns over a file's name, matched without regard to case: `*` stands for any
 * run of characters, `?` for any one. The first `*` in {@link parent} is remembered, and each child
 * pattern can use it as `${capture}`; `${basename}` is the parent's name without its last extension,
 * and `${extname}` that extension, without its dot. So `*.cs` with `${capture}.*.cs` gathers
 * `Enumeration.Comparable.cs` under `Enumeration.cs`, and leaves `Extensions.String.cs` where it is
 * when there is no `Extensions.cs`.
 */
export interface FileNestingRule {
  /**
   * Gets the pattern a parent's name matches, such as `*.cs`.
   */
  readonly parent: string;

  /**
   * Gets the patterns its children's names match, separated by commas, such as
   * `${capture}.*.cs, ${capture}.resx`.
   */
  readonly children: string;
}

/**
 * The rules File Nesting starts with: the .NET pairings, where one type or one page is split across
 * several files that share its name.
 */
export const DEFAULT_FILE_NESTING_RULES: readonly FileNestingRule[] = [
  { parent: '*.cs', children: '${capture}.*.cs, ${capture}.resx' },
  { parent: '*.vb', children: '${capture}.*.vb, ${capture}.resx' },
  { parent: '*.razor', children: '${capture}.razor.cs, ${capture}.razor.css, ${capture}.razor.js' },
  { parent: '*.cshtml', children: '${capture}.cshtml.cs, ${capture}.cshtml.css' },
  { parent: '*.xaml', children: '${capture}.xaml.cs' },
  { parent: '*.axaml', children: '${capture}.axaml.cs' },
  { parent: '*.aspx', children: '${capture}.aspx.cs, ${capture}.aspx.designer.cs' },
];

/**
 * How one folder's files nest: which gather others beneath them, and which are gathered.
 */
export interface FileNesting<T> {
  /**
   * Gets the files gathered beneath each parent, in the order they were given.
   */
  readonly children: ReadonlyMap<T, readonly T[]>;

  /**
   * Gets every file gathered beneath a parent, so it is left out of the folder's own run.
   */
  readonly nested: ReadonlySet<T>;
}

/**
 * A rule made ready to match: its parent pattern as an expression whose first group is the capture,
 * and its child patterns as written.
 */
interface CompiledRule {
  /**
   * Gets the expression a parent's name matches.
   */
  readonly parent: RegExp;

  /**
   * Gets the child patterns, trimmed, with the empty ones dropped.
   */
  readonly children: readonly string[];
}

/**
 * A child pattern resolved for one parent: the expression a child's name matches, and the literal
 * text every match starts with, by which the candidates are found without testing every file.
 */
interface ChildMatcher {
  /**
   * Gets the expression a child's name matches.
   */
  readonly pattern: RegExp;

  /**
   * Gets the lower-cased text every matching name starts with; empty when the pattern starts with a
   * wildcard.
   */
  readonly prefix: string;
}

/**
 * A file that could gather others: its index among the folder's files, and what its children match.
 */
interface ParentCandidate {
  /**
   * Gets the file's index.
   */
  readonly index: number;

  /**
   * Gets the matchers its children's names are tested against.
   */
  readonly matchers: readonly ChildMatcher[];
}

/**
 * Holds the rules compiled for each rule list, so a tree rebuilt on every change compiles its rules
 * once rather than per folder.
 */
const COMPILED: WeakMap<readonly FileNestingRule[], readonly CompiledRule[]> = new WeakMap<
  readonly FileNestingRule[],
  readonly CompiledRule[]
>();

/**
 * Nests one folder's files by the File Nesting rules.
 *
 * A file nests one level deep: a parent is never itself gathered, and a gathered file gathers
 * nothing. Where a file could go under more than one parent, the shortest name takes it — so
 * `A.B.C.cs` goes under `A.cs` alongside `A.B.cs`, rather than under `A.B.cs`; without an `A.cs`,
 * `A.B.cs` takes it.
 * @param files The folder's files — its folders are no part of nesting.
 * @param nameOf Reads a file's name.
 * @param rules The rules.
 * @returns Returns how the files nest; nothing nests when no rule applies.
 */
export function nestFiles<T>(
  files: readonly T[],
  nameOf: (file: T) => string,
  rules: readonly FileNestingRule[],
): FileNesting<T> {
  const children: Map<T, T[]> = new Map<T, T[]>();
  const nested: Set<T> = new Set<T>();
  const compiled: readonly CompiledRule[] = compile(rules);
  if (files.length < 2 || compiled.length === 0) {
    return { children, nested };
  }
  const names: readonly string[] = files.map(nameOf);
  const lower: readonly string[] = names.map((name: string): string => name.toLowerCase());
  // The files in name order, so the candidates for a prefix are one run found by binary search.
  const byName: readonly number[] = files
    .map((_file: T, index: number): number => index)
    .sort((a: number, b: number): number =>
      lower[a] < lower[b] ? -1 : lower[a] > lower[b] ? 1 : 0,
    );
  const parents: ParentCandidate[] = [];
  names.forEach((name: string, index: number): void => {
    const matchers: ChildMatcher[] = compiled.flatMap((rule: CompiledRule): ChildMatcher[] =>
      matchersFor(rule, name),
    );
    if (matchers.length > 0) {
      parents.push({ index, matchers });
    }
  });
  parents.sort(
    (a: ParentCandidate, b: ParentCandidate): number =>
      names[a.index].length - names[b.index].length || a.index - b.index,
  );
  const parentIndexes: Set<number> = new Set<number>();
  const claimed: Set<number> = new Set<number>();
  for (const parent of parents) {
    if (claimed.has(parent.index)) {
      continue;
    }
    const found: Set<number> = new Set<number>();
    for (const matcher of parent.matchers) {
      for (const candidate of candidatesFor(matcher.prefix, byName, lower)) {
        if (
          candidate !== parent.index &&
          !claimed.has(candidate) &&
          !parentIndexes.has(candidate) &&
          matcher.pattern.test(names[candidate])
        ) {
          found.add(candidate);
        }
      }
    }
    if (found.size === 0) {
      continue;
    }
    parentIndexes.add(parent.index);
    const kids: T[] = [...found]
      .sort((a: number, b: number): number => a - b)
      .map((index: number): T => {
        claimed.add(index);
        nested.add(files[index]);
        return files[index];
      });
    children.set(files[parent.index], kids);
  }
  return { children, nested };
}

/**
 * Names a nested file after its parent is renamed, so the group keeps its shape: the part of the
 * child's name its parent's base name supplies is replaced with the new base name.
 * `Enumeration.Comparable.cs`, under `Enumeration.cs` renamed `Ordinal.cs`, becomes
 * `Ordinal.Comparable.cs`. A child whose name does not start with its parent's base name keeps it.
 * @param child The nested file's name.
 * @param parent The parent's name as it stands.
 * @param renamed The parent's new name.
 * @returns Returns the child's new name, or its name unchanged.
 */
export function nestedRename(child: string, parent: string, renamed: string): string {
  const base: string = baseName(parent);
  const next: string = baseName(renamed);
  if (base.length === 0 || base === next || !child.startsWith(base)) {
    return child;
  }
  const rest: string = child.slice(base.length);
  return rest.startsWith('.') ? `${next}${rest}` : child;
}

/**
 * Reads the rules from a setting's value, keeping the well-formed ones: the value is the user's, and
 * may have been imported from a file.
 * @param value The setting's value.
 * @returns Returns the rules.
 */
export function fileNestingRules(value: unknown): readonly FileNestingRule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry: unknown): entry is FileNestingRule =>
      typeof entry === 'object' &&
      entry !== null &&
      'parent' in entry &&
      'children' in entry &&
      typeof entry.parent === 'string' &&
      typeof entry.children === 'string' &&
      entry.parent.trim().length > 0 &&
      entry.children.trim().length > 0,
  );
}

/**
 * Compiles a rule list, once per list.
 * @param rules The rules.
 * @returns Returns the compiled rules.
 */
function compile(rules: readonly FileNestingRule[]): readonly CompiledRule[] {
  const cached: readonly CompiledRule[] | undefined = COMPILED.get(rules);
  if (cached !== undefined) {
    return cached;
  }
  const compiled: readonly CompiledRule[] = rules.map((rule: FileNestingRule): CompiledRule => ({
    parent: new RegExp(`^${globSource(rule.parent.trim(), true)}$`, 'i'),
    children: rule.children
      .split(',')
      .map((child: string): string => child.trim())
      .filter((child: string): boolean => child.length > 0),
  }));
  COMPILED.set(rules, compiled);
  return compiled;
}

/**
 * Resolves a rule's child patterns for a file that could be a parent.
 * @param rule The rule.
 * @param name The file's name.
 * @returns Returns the matchers, or none when the name does not match the rule's parent pattern.
 */
function matchersFor(rule: CompiledRule, name: string): ChildMatcher[] {
  const match: RegExpExecArray | null = rule.parent.exec(name);
  if (match === null) {
    return [];
  }
  const dot: number = name.lastIndexOf('.');
  const values: ReadonlyMap<string, string> = new Map<string, string>([
    ['capture', match[1] ?? ''],
    ['basename', dot > 0 ? name.slice(0, dot) : name],
    ['extname', dot > 0 ? name.slice(dot + 1) : ''],
  ]);
  return rule.children.map((child: string): ChildMatcher => {
    // Each variable becomes literal text, so a name with `*` or `?` in it stands for itself.
    let source: string = '';
    let prefix: string = '';
    let literal: boolean = true;
    for (const part of child.split(/(\$\{[a-z]+\})/)) {
      const variable: RegExpExecArray | null = /^\$\{([a-z]+)\}$/.exec(part);
      const value: string | undefined = variable === null ? undefined : values.get(variable[1]);
      if (value !== undefined) {
        source += escapeRegExp(value);
        if (literal) {
          prefix += value;
        }
        continue;
      }
      source += globSource(part, false);
      const wildcard: number = part.search(/[*?]/);
      if (literal) {
        prefix += wildcard < 0 ? part : part.slice(0, wildcard);
      }
      literal &&= wildcard < 0;
    }
    return { pattern: new RegExp(`^${source}$`, 'i'), prefix: prefix.toLowerCase() };
  });
}

/**
 * Finds the files whose names start with a prefix, by binary search over the names in order.
 * @param prefix The lower-cased prefix; empty for every file.
 * @param byName The files' indexes, in lower-cased name order.
 * @param lower The files' lower-cased names, by index.
 * @returns Returns the indexes of the files that start with it.
 */
function candidatesFor(
  prefix: string,
  byName: readonly number[],
  lower: readonly string[],
): readonly number[] {
  if (prefix.length === 0) {
    return byName;
  }
  let low: number = 0;
  let high: number = byName.length;
  while (low < high) {
    const middle: number = (low + high) >>> 1;
    if (lower[byName[middle]] < prefix) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  let end: number = low;
  while (end < byName.length && lower[byName[end]].startsWith(prefix)) {
    end++;
  }
  return byName.slice(low, end);
}

/**
 * Turns a wildcard pattern into the source of a regular expression.
 * @param pattern The pattern.
 * @param capture Whether its first `*` is captured.
 * @returns Returns the expression's source, unanchored.
 */
function globSource(pattern: string, capture: boolean): string {
  let captured: boolean = !capture;
  let source: string = '';
  for (const character of pattern) {
    if (character === '*') {
      source += captured ? '.*' : '(.*)';
      captured = true;
    } else if (character === '?') {
      source += '.';
    } else {
      source += escapeRegExp(character);
    }
  }
  return source;
}

/**
 * Escapes the characters a regular expression gives a meaning of their own.
 * @param text The text.
 * @returns Returns the text, matching itself.
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reads a file's name without its last extension.
 * @param name The name.
 * @returns Returns the base name, or the whole name when it has no extension.
 */
function baseName(name: string): string {
  const dot: number = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}
