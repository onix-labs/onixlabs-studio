/**
 * Removes a TOML document's comments, leaving strings alone: a `#` in a string is not a comment, and a
 * quote in a comment must not be read as a string.
 * @param toml The document.
 * @returns Returns the document without its comments.
 */
function stripComments(toml: string): string {
  let result: string = '';
  let quote: string | null = null;
  for (let index: number = 0; index < toml.length; index += 1) {
    const character: string = toml[index];
    if (quote !== null) {
      if (character === '\\' && quote === '"') {
        result += character + (toml[index + 1] ?? '');
        index += 1;
        continue;
      }
      if (character === quote) {
        quote = null;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '#') {
      while (index + 1 < toml.length && toml[index + 1] !== '\n') {
        index += 1;
      }
      continue;
    }
    result += character;
  }
  return result;
}

/**
 * Reads one table's body from a comment-free TOML document.
 * @param toml The document.
 * @param name The table's dotted name, without its brackets.
 * @returns Returns the text between the table's header and the next header, or null when it has none.
 */
function tableBody(toml: string, name: string): string | null {
  const lines: readonly string[] = toml.split('\n');
  const start: number = lines.findIndex((line: string): boolean => line.trim() === `[${name}]`);
  if (start === -1) {
    return null;
  }
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[{1,2}[A-Za-z]/.test(line)) {
      break;
    }
    body.push(line);
  }
  return body.join('\n');
}

/**
 * Reads a string key from a table's body.
 * @param body The table's body, or null when the table is absent.
 * @param key The key.
 * @returns Returns the value, or null when the key is absent or is not a string.
 */
function stringKey(body: string | null, key: string): string | null {
  const match: RegExpExecArray | null =
    body === null ? null : new RegExp(`^\\s*${key}\\s*=\\s*['"]([^'"]*)['"]`, 'm').exec(body);
  return match === null ? null : match[1];
}

/**
 * Reads an array key from a table's body, as the raw text between its brackets.
 * @param body The table's body, or null when the table is absent.
 * @param key The key.
 * @returns Returns the array's text, or null when the key is absent or is not an array.
 */
function arrayKey(body: string | null, key: string): string | null {
  const match: RegExpExecArray | null =
    body === null ? null : new RegExp(`^\\s*${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm').exec(body);
  return match === null ? null : match[1];
}

/**
 * Reads an array-of-strings key from a table's body.
 * @param body The table's body, or null when the table is absent.
 * @param key The key.
 * @returns Returns the strings, in order, and none when the key is absent.
 */
function stringsKey(body: string | null, key: string): readonly string[] {
  const array: string | null = arrayKey(body, key);
  if (array === null) {
    return [];
  }
  return [...array.matchAll(/['"]([^'"]+)['"]/g)].map((match: RegExpExecArray): string => match[1]);
}

/**
 * Joins a declared root directory and a path beneath it.
 * @param root The root, which may be empty or `.`.
 * @param relative The path beneath it.
 * @returns Returns the joined path, slash-delimited.
 */
function under(root: string, relative: string): string {
  const base: string = root.replace(/^\.\/?/, '').replace(/\/+$/, '');
  return base.length > 0 ? `${base}/${relative}` : relative;
}

/**
 * Reads what setuptools declares. An explicit list of packages wins, each reduced to its top-level
 * folder; otherwise `packages.find`, whose `where` folders are the sources unless they are the project
 * root, where only its `include` patterns narrow anything. A search of the root with no patterns says
 * nothing, so it declares nothing.
 * @param toml The comment-free document.
 * @returns Returns the declared paths.
 */
function setuptoolsPaths(toml: string): readonly string[] {
  const table: string | null = tableBody(toml, 'tool.setuptools');
  const mapping: string | null = tableBody(toml, 'tool.setuptools.package-dir');
  // `package-dir = {"" = "src"}`, or the same mapping written as its own table.
  const root: string =
    /(?:^|[\s{,])(?:""|'')\s*=\s*['"]([^'"]+)['"]/m.exec(`${table ?? ''}\n${mapping ?? ''}`)?.[1] ??
    '';
  const modules: readonly string[] = stringsKey(table, 'py-modules').map((module: string): string =>
    under(root, `${module.replaceAll('.', '/')}.py`),
  );
  const packages: readonly string[] = stringsKey(table, 'packages');
  if (packages.length > 0) {
    const tops: readonly string[] = packages.map((name: string): string =>
      under(root, name.split('.')[0]),
    );
    return [...tops, ...modules];
  }
  const find: string | null = tableBody(toml, 'tool.setuptools.packages.find');
  if (find === null) {
    return modules;
  }
  const paths: string[] = [...modules];
  const roots: readonly string[] = stringsKey(find, 'where');
  for (const where of roots.length > 0 ? roots : ['.']) {
    if (!/^\.?\/?$/.test(where)) {
      paths.push(where);
      continue;
    }
    for (const pattern of stringsKey(find, 'include')) {
      // `foo*` and `foo.*` both name the folder `foo`; any other pattern is left to the listing.
      const name: string = pattern.replace(/\.?\*$/, '');
      if (/^[A-Za-z0-9_]+$/.test(name)) {
        paths.push(name);
      }
    }
  }
  return paths;
}

/**
 * Reads what Poetry's `packages` entries declare, skipping a glob, which names no one path.
 * @param toml The comment-free document.
 * @returns Returns the declared paths.
 */
function poetryPaths(toml: string): readonly string[] {
  const array: string | null = arrayKey(tableBody(toml, 'tool.poetry'), 'packages');
  if (array === null) {
    return [];
  }
  const paths: string[] = [];
  for (const entry of array.matchAll(/\{([^}]*)\}/g)) {
    const include: string | undefined = /\binclude\s*=\s*['"]([^'"]+)['"]/.exec(entry[1])?.[1];
    const from: string = /\bfrom\s*=\s*['"]([^'"]+)['"]/.exec(entry[1])?.[1] ?? '';
    if (include !== undefined && !include.includes('*')) {
      paths.push(under(from, include));
    }
  }
  return paths;
}

/**
 * Reads the paths a `pyproject.toml` declares its packages and modules at, across the build backends
 * that declare them statically (setuptools, Hatch, Poetry, PDM, Flit, uv and Maturin). A candidate need
 * not exist: Flit names a module that may be a folder, a file or under `src`, so the caller keeps those
 * that do. Nothing here runs a backend: anything a backend would have to compute is left undeclared,
 * and the project is listed as it always was.
 * @param toml The `pyproject.toml` content.
 * @returns Returns the declared paths relative to the project, slash-delimited, and untrusted: the
 * caller confines them to the project.
 */
export function declaredPackagePaths(toml: string): readonly string[] {
  const document: string = stripComments(toml);
  const flit: string | null = stringKey(tableBody(document, 'tool.flit.module'), 'name');
  const uvBackend: string | null = tableBody(document, 'tool.uv.build-backend');
  const uvName: string | null = stringKey(uvBackend, 'module-name');
  const hatchWheel: string | null = tableBody(document, 'tool.hatch.build.targets.wheel');
  const pdmRoot: string | null = stringKey(tableBody(document, 'tool.pdm.build'), 'package-dir');
  const maturin: string | null = stringKey(tableBody(document, 'tool.maturin'), 'python-source');
  const paths: readonly string[] = [
    ...setuptoolsPaths(document),
    ...poetryPaths(document),
    ...stringsKey(hatchWheel, 'packages'),
    ...stringsKey(hatchWheel, 'only-include'),
    ...(flit === null ? [] : [flit, `${flit}.py`, `src/${flit}`, `src/${flit}.py`]),
    ...(uvName === null
      ? []
      : [under(stringKey(uvBackend, 'module-root') ?? 'src', uvName.replaceAll('.', '/'))]),
    ...(pdmRoot === null ? [] : [pdmRoot]),
    ...(maturin === null ? [] : [maturin]),
  ];
  return [...new Set<string>(paths)];
}

/**
 * Determines whether a `pyproject.toml` describes something that is built, which is what makes a `src`
 * folder the sources every backend would find there. A file with no `[build-system]` may be nothing but
 * a tool's configuration.
 * @param toml The `pyproject.toml` content.
 * @returns Returns true when the document has a `[build-system]` table.
 */
export function declaresBuildSystem(toml: string): boolean {
  return tableBody(stripComments(toml), 'build-system') !== null;
}
