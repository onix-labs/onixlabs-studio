import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * The name of the configuration TypeScript reads from a package's folder.
 */
const TSCONFIG: string = 'tsconfig.json';

/**
 * Bounds how far an `extends` chain is followed, so a cycle cannot hold a scan.
 */
const MAX_EXTENDS_DEPTH: number = 8;

/**
 * The characters that make a path segment a pattern rather than a name.
 */
const GLOB_CHARACTERS: RegExp = /[*?[\]{}()!]/;

/**
 * What a package's TypeScript configuration says its sources are.
 */
export interface TsconfigSources {
  /**
   * Gets the files and folders the configuration compiles, relative to the package, slash-delimited,
   * and untrusted: the caller confines them to the package.
   */
  readonly roots: readonly string[];

  /**
   * Gets the output folders it writes to, relative to the package.
   */
  readonly outputs: readonly string[];

  /**
   * Gets whether it compiles the package's whole folder, as one with no `include` does, which says
   * nothing about what the package is made of.
   */
  readonly coversPackage: boolean;
}

/**
 * A configuration read through its `extends` chain, its paths absolute.
 */
interface ResolvedConfig {
  /**
   * Gets its `include` patterns, or undefined when no configuration in the chain has any.
   */
  readonly include: readonly string[] | undefined;

  /**
   * Gets its `files`, or undefined when no configuration in the chain has any.
   */
  readonly files: readonly string[] | undefined;

  /**
   * Gets its `outDir`, or undefined when no configuration in the chain has one.
   */
  readonly outDir: string | undefined;

  /**
   * Gets the configuration file's own parsed content.
   */
  readonly own: Record<string, unknown>;
}

/**
 * Parses JSON with comments and trailing commas, which is what a `tsconfig.json` is. Strings are
 * skipped whole, because a glob in one holds what looks like the start of a comment.
 * @param text The text.
 * @returns Returns the parsed object, or null when it is not one.
 */
export function parseJsonc(text: string): Record<string, unknown> | null {
  let result: string = '';
  for (let index: number = 0; index < text.length; index += 1) {
    const character: string = text[index];
    const next: string | undefined = text[index + 1];
    if (character === '"') {
      const start: number = index;
      index += 1;
      while (index < text.length && text[index] !== '"') {
        index += text[index] === '\\' ? 2 : 1;
      }
      result += text.slice(start, index + 1);
    } else if (character === '/' && next === '/') {
      while (index + 1 < text.length && text[index + 1] !== '\n') {
        index += 1;
      }
    } else if (character === '/' && next === '*') {
      const end: number = text.indexOf('*/', index + 2);
      index = end === -1 ? text.length : end + 1;
    } else {
      result += character;
    }
  }
  try {
    const parsed: unknown = JSON.parse(result.replace(/^\uFEFF/, '').replace(/,(\s*[}\]])/g, '$1'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Reads the part of a pattern before its first wildcard, so a glob under `src` is `src`, and a plain
 * path is itself. Listing the whole folder is what is wanted, since a project's tests and data sit beside its
 * sources and a pattern narrower than a folder says nothing about what else belongs there.
 * @param pattern The pattern.
 * @returns Returns the prefix, slash-delimited, and empty when the pattern starts with a wildcard.
 */
export function staticPrefix(pattern: string): string {
  const segments: readonly string[] = pattern
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment: string): boolean => segment.length > 0 && segment !== '.');
  const first: number = segments.findIndex((segment: string): boolean =>
    GLOB_CHARACTERS.test(segment),
  );
  return (first === -1 ? segments : segments.slice(0, first)).join('/');
}

/**
 * Reads the files and folders a package's `files` field names. The field says what is published, which
 * is often the output, so the caller drops anything that is one. A negated entry takes nothing away,
 * because the listing is by folder.
 * @param files The field's value.
 * @returns Returns the paths relative to the package, slash-delimited, and untrusted.
 */
export function publishedRoots(files: unknown): readonly string[] {
  if (!Array.isArray(files)) {
    return [];
  }
  return (files as readonly unknown[])
    .filter((entry: unknown): entry is string => typeof entry === 'string')
    .filter((entry: string): boolean => !entry.startsWith('!'))
    .map(staticPrefix)
    .filter((prefix: string): boolean => prefix.length > 0);
}

/**
 * Reads a value as a list of strings.
 * @param value The value.
 * @returns Returns the strings, or undefined when the value is not an array.
 */
function stringList(value: unknown): readonly string[] | undefined {
  return Array.isArray(value)
    ? (value as readonly unknown[]).filter(
        (entry: unknown): entry is string => typeof entry === 'string',
      )
    : undefined;
}

/**
 * Reads a list of paths from a configuration, anchored to the folder it sits in. A later configuration
 * in a chain replaces these rather than adding to them, and its paths mean its own folder.
 * @param value The value.
 * @param directory The configuration's folder.
 * @returns Returns the absolute paths, a wildcard left in place, or undefined when the value is not a
 * list.
 */
function anchored(value: unknown, directory: string): readonly string[] | undefined {
  return stringList(value)?.map((entry: string): string =>
    path.isAbsolute(entry) ? entry : path.join(directory, entry),
  );
}

/**
 * Reads a configuration through its `extends` chain. Only a relative `extends` is followed: a package
 * from `node_modules` holds compiler options, not a project's sources.
 * @param file The configuration's absolute path.
 * @param depth How many configurations have led here.
 * @returns Returns the configuration, or null when it cannot be read.
 */
async function readConfig(file: string, depth: number): Promise<ResolvedConfig | null> {
  if (depth > MAX_EXTENDS_DEPTH) {
    return null;
  }
  let own: Record<string, unknown> | null;
  try {
    own = parseJsonc(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
  if (own === null) {
    return null;
  }
  const directory: string = path.dirname(file);
  let include: readonly string[] | undefined;
  let files: readonly string[] | undefined;
  let outDir: string | undefined;
  const bases: unknown = own['extends'];
  for (const base of (Array.isArray(bases) ? bases : [bases]) as readonly unknown[]) {
    if (typeof base === 'string' && base.startsWith('.')) {
      const target: string = path.resolve(directory, base);
      const next: ResolvedConfig | null = await readConfig(
        target.endsWith('.json') ? target : `${target}.json`,
        depth + 1,
      );
      // A later base replaces what an earlier one said, key by key.
      include = next?.include ?? include;
      files = next?.files ?? files;
      outDir = next?.outDir ?? outDir;
    }
  }
  const options: { outDir?: unknown } | null =
    (own['compilerOptions'] as { outDir?: unknown } | null | undefined) ?? null;
  return {
    include: anchored(own['include'], directory) ?? include,
    files: anchored(own['files'], directory) ?? files,
    outDir: typeof options?.outDir === 'string' ? path.resolve(directory, options.outDir) : outDir,
    own,
  };
}

/**
 * Gets the configurations a configuration's `references` name, inside the package. A reference that
 * leaves the package is another package's business.
 * @param config The configuration.
 * @param file Its absolute path.
 * @param directory The package's directory.
 * @returns Returns the referenced configurations' absolute paths.
 */
function referencedConfigs(
  config: ResolvedConfig,
  file: string,
  directory: string,
): readonly string[] {
  const references: unknown = config.own['references'];
  if (!Array.isArray(references)) {
    return [];
  }
  const configs: string[] = [];
  for (const reference of references as readonly unknown[]) {
    const target: unknown = (reference as { path?: unknown } | null)?.path;
    if (typeof target !== 'string') {
      continue;
    }
    const resolved: string = path.resolve(path.dirname(file), target);
    if (resolved === directory || resolved.startsWith(`${directory}${path.sep}`)) {
      configs.push(resolved.endsWith('.json') ? resolved : path.join(resolved, TSCONFIG));
    }
  }
  return configs;
}

/**
 * Reads what a package's `tsconfig.json` says its sources are, following a solution-style configuration
 * through its `references` to the ones that name files.
 * @param directory The package's directory.
 * @returns Returns the sources, or null when the package has no readable configuration.
 */
export async function readTsconfigSources(directory: string): Promise<TsconfigSources | null> {
  const seen: Set<string> = new Set<string>();
  const queue: string[] = [path.join(directory, TSCONFIG)];
  const roots: Set<string> = new Set<string>();
  const outputs: Set<string> = new Set<string>();
  let coversPackage: boolean = false;
  while (queue.length > 0) {
    const file: string = queue.shift()!;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    const config: ResolvedConfig | null = await readConfig(file, 0);
    if (config === null) {
      if (seen.size === 1) {
        return null;
      }
      continue;
    }
    if (config.outDir !== undefined) {
      outputs.add(path.relative(directory, config.outDir).replace(/\\/g, '/'));
    }
    // With neither key, TypeScript compiles everything under the configuration.
    const patterns: readonly string[] =
      config.include === undefined && config.files === undefined
        ? [path.join(path.dirname(file), '**', '*')]
        : [...(config.include ?? []), ...(config.files ?? [])];
    for (const pattern of patterns) {
      const relative: string = staticPrefix(
        path.relative(directory, pattern.replace(/[\\/]\*\*[\\/]?.*$/, '')),
      );
      if (relative.length === 0) {
        coversPackage = true;
      } else {
        roots.add(relative);
      }
    }
    queue.push(...referencedConfigs(config, file, directory));
  }
  return { roots: [...roots], outputs: [...outputs], coversPackage };
}
