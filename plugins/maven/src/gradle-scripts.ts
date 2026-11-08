// Reads Gradle build scripts (Groovy `build.gradle` and Kotlin `build.gradle.kts`) and their companions:
// `settings.gradle(.kts)`, `gradle.properties` and `gradle.lockfile`.
//
// ⚠️ A build script is a program. This reads the declarations the overwhelming majority of builds write
// literally — `implementation("g:a:v")`, `testImplementation 'g:a:v'`, the map form, `libs.…` catalog
// references, `platform(…)` — and nothing a script computes: a dependency added in a loop, by a
// convention plugin, from `buildSrc`, or under a name built at run time is not seen. Only Gradle itself
// can say what a script really declares, and asking it means running the build, which this plugin
// never does.

import { PackageDependencyScope } from './protocol';

/**
 * One dependency a script declares.
 */
export interface GradleDeclaration {
  /**
   * Gets the configuration it is declared in, such as `implementation` or `testRuntimeOnly`.
   */
  readonly configuration: string;

  /**
   * Gets how it is written: as coordinates, or as a version-catalog reference.
   */
  readonly kind: 'coordinates' | 'catalog';

  /**
   * Gets the coordinates (`group:artifact` and an optional version, still holding any `$variable`), or
   * the catalog accessor after `libs.` (`bundles.x` for a bundle).
   */
  readonly notation: string;

  /**
   * Gets the version, for coordinates written with one, or null.
   */
  readonly version: string | null;
}

/**
 * A repository a script declares.
 */
export interface GradleRepositoryDeclaration {
  /**
   * Gets the repository's URL. The well-known shorthands (`mavenCentral()`, `google()`,
   * `gradlePluginPortal()`) are given theirs.
   */
  readonly url: string;

  /**
   * Gets the repository's `name`, which `gradle.properties` credentials are keyed by, or null.
   */
  readonly name: string | null;

  /**
   * Gets whether the declaration asks for credentials.
   */
  readonly credentials: boolean;
}

/**
 * What a settings script says about the build's projects.
 */
export interface GradleSettings {
  /**
   * Gets the root project's name, or null when the script does not set it.
   */
  readonly rootName: string | null;

  /**
   * Gets each included project's directory relative to the build root, by its project path (`:app`).
   */
  readonly projects: ReadonlyMap<string, string>;
}

/**
 * The configurations whose names end a dependency configuration, so `implementation`,
 * `testImplementation` and `debugRuntimeOnly` are all recognised while `println` or `id` are not.
 */
const CONFIGURATION: RegExp =
  /^(?:[a-z][A-Za-z0-9]*?)?(?:implementation|Implementation|api|Api|compileOnly|CompileOnly|runtimeOnly|RuntimeOnly|compile|Compile|runtime|Runtime|annotationProcessor|AnnotationProcessor|kapt|Kapt|ksp|Ksp)$|^(?:classpath|developmentOnly|testFixturesApi)$/;

/**
 * The repository shorthands and the URLs they stand for.
 */
const SHORTHAND_REPOSITORIES: Readonly<Record<string, string>> = {
  mavenCentral: 'https://repo.maven.apache.org/maven2',
  google: 'https://dl.google.com/dl/android/maven2',
  gradlePluginPortal: 'https://plugins.gradle.org/m2',
};

/**
 * Removes comments from a script, leaving strings alone, so a commented-out dependency is not read and
 * a `//` inside a URL is not taken for a comment.
 * @param source The script.
 * @returns Returns the script without comments.
 */
export function stripComments(source: string): string {
  let result: string = '';
  let index: number = 0;
  while (index < source.length) {
    const character: string = source[index];
    if (character === '"' || character === "'") {
      const end: number = stringEnd(source, index);
      result += source.slice(index, end);
      index = end;
    } else if (source.startsWith('//', index)) {
      const end: number = source.indexOf('\n', index);
      index = end < 0 ? source.length : end;
    } else if (source.startsWith('/*', index)) {
      const end: number = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 2;
      result += ' ';
    } else {
      result += character;
      index += 1;
    }
  }
  return result;
}

/**
 * Finds where a quoted string ends: after its closing quote, or at the end of its line.
 * @param source The script.
 * @param from The index of the opening quote.
 * @returns Returns the index after the string.
 */
function stringEnd(source: string, from: number): number {
  const quote: string = source[from];
  for (let index: number = from + 1; index < source.length; index += 1) {
    const character: string = source[index];
    if (character === '\\') {
      index += 1;
    } else if (character === quote) {
      return index + 1;
    } else if (character === '\n') {
      return index;
    }
  }
  return source.length;
}

/**
 * Blanks out every `name { … }` block, braces balanced, so what is inside it is not read: a
 * `constraints { }` block says which versions to prefer, not what the project depends on.
 * @param source The script, without comments.
 * @param name The block's name.
 * @returns Returns the script without those blocks.
 */
export function removeBlocks(source: string, name: string): string {
  const opening: RegExp = new RegExp(`\\b${name}\\s*\\{`, 'g');
  let result: string = source;
  for (let match: RegExpExecArray | null = opening.exec(result); match !== null;) {
    let depth: number = 0;
    let end: number = result.length;
    for (let index: number = match.index + match[0].length - 1; index < result.length; index += 1) {
      if (result[index] === '{') {
        depth += 1;
      } else if (result[index] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }
    result = `${result.slice(0, match.index)}${' '.repeat(end - match.index)}${result.slice(end)}`;
    opening.lastIndex = 0;
    match = opening.exec(result);
  }
  return result;
}

/**
 * Determines whether a name is a dependency configuration this plugin reads.
 * @param name The name.
 * @returns Returns true for one.
 */
export function isConfiguration(name: string): boolean {
  return CONFIGURATION.test(name);
}

/**
 * Maps a Gradle configuration onto Studio's scopes: test, test-fixture and Android test configurations,
 * annotation processors, `classpath` (the build's own tooling) and `developmentOnly` are development;
 * `compileOnly` — there to compile against, supplied at run time by something else — is a peer, as
 * Maven's `provided` is; everything else (`implementation`, `api`, `runtimeOnly`, a variant's
 * `debugImplementation`) is production. Gradle has no optional dependencies a script can declare
 * plainly (feature variants are not read), so `optional` is never given.
 * @param configuration The configuration.
 * @returns Returns Studio's scope.
 */
export function gradleScope(configuration: string): PackageDependencyScope {
  if (
    /^(?:test|androidTest|testFixtures)/.test(configuration) ||
    /(?:annotationProcessor|AnnotationProcessor|kapt|Kapt|ksp|Ksp)$/.test(configuration) ||
    configuration === 'classpath' ||
    configuration === 'developmentOnly'
  ) {
    return 'development';
  }
  return /(?:^c|C)ompileOnly$/.test(configuration) ? 'peer' : 'production';
}

/**
 * Reads the dependencies a script declares literally.
 * @param script The script.
 * @returns Returns the declarations, in the order written.
 */
export function parseGradleDependencies(script: string): readonly GradleDeclaration[] {
  const source: string = removeBlocks(stripComments(script), 'constraints');
  const declarations: GradleDeclaration[] = [];
  const call: RegExp =
    /\b([a-z][A-Za-z0-9]*)\s*(?:\(\s*|\s+)(?:(?:platform|enforcedPlatform)\s*\(\s*)?(?:(["'])([^"'\n]+)\2|libs\.([A-Za-z][\w.]*)|(group\s*[:=][^)\n]*))/g;
  for (const match of source.matchAll(call)) {
    const configuration: string = match[1];
    if (!isConfiguration(configuration)) {
      continue;
    }
    if (match[3] !== undefined) {
      const coordinates: GradleDeclaration | null = fromCoordinates(configuration, match[3]);
      if (coordinates !== null) {
        declarations.push(coordinates);
      }
    } else if (match[4] !== undefined) {
      declarations.push({
        configuration,
        kind: 'catalog',
        notation: match[4].replace(/\.(?:get|asProvider)$/, ''),
        version: null,
      });
    } else if (match[5] !== undefined) {
      const map: GradleDeclaration | null = fromMap(configuration, match[5]);
      if (map !== null) {
        declarations.push(map);
      }
    }
  }
  return declarations;
}

/**
 * Reads string notation, `group:artifact[:version[:classifier]][@extension]`.
 * @param configuration The configuration.
 * @param text The string.
 * @returns Returns the declaration, or null when the string is not coordinates.
 */
function fromCoordinates(configuration: string, text: string): GradleDeclaration | null {
  const parts: readonly string[] = text.split('@')[0].split(':');
  if (parts.length < 2 || parts.slice(0, 2).some((part: string): boolean => part.length === 0)) {
    return null;
  }
  return {
    configuration,
    kind: 'coordinates',
    notation: `${parts[0]}:${parts[1]}`,
    version: parts[2] !== undefined && parts[2].length > 0 ? parts[2] : null,
  };
}

/**
 * Reads map notation: `group: 'g', name: 'a', version: 'v'` (Groovy) or
 * `group = "g", name = "a", version = "v"` (Kotlin).
 * @param configuration The configuration.
 * @param text The arguments.
 * @returns Returns the declaration, or null when there is no group and name.
 */
function fromMap(configuration: string, text: string): GradleDeclaration | null {
  const value: (key: string) => string | null = (key: string): string | null =>
    new RegExp(`\\b${key}\\s*[:=]\\s*(["'])([^"']*)\\1`).exec(text)?.[2] ?? null;
  const group: string | null = value('group');
  const name: string | null = value('name');
  if (group === null || name === null) {
    return null;
  }
  const version: string | null = value('version');
  return {
    configuration,
    kind: 'coordinates',
    notation: `${group}:${name}`,
    version: version === null || version.length === 0 ? null : version,
  };
}

/**
 * Reads the repositories a script declares: the shorthands, and `maven { url … }` / `maven("…")`
 * blocks with their `name` and whether they ask for credentials.
 * @param script The script.
 * @returns Returns the repositories, in the order written.
 */
export function parseGradleRepositories(script: string): readonly GradleRepositoryDeclaration[] {
  const source: string = stripComments(script);
  const repositories: { index: number; repository: GradleRepositoryDeclaration }[] = [];
  for (const match of source.matchAll(/\b(mavenCentral|google|gradlePluginPortal)\s*\(\s*\)/g)) {
    repositories.push({
      index: match.index,
      repository: { url: SHORTHAND_REPOSITORIES[match[1]], name: null, credentials: false },
    });
  }
  for (const match of source.matchAll(
    /\bmaven\s*\(\s*(?:url\s*=\s*)?(?:uri\(\s*)?(["'])([^"']+)\1/g,
  )) {
    repositories.push({
      index: match.index,
      repository: { url: match[2], name: null, credentials: false },
    });
  }
  for (const match of source.matchAll(/\bmaven\s*\{/g)) {
    const body: string = blockBody(source, match.index + match[0].length - 1);
    const url: string | null =
      /\b(?:url|setUrl)\s*(?:=|\(|\s)\s*(?:uri\(\s*)?(["'])([^"']+)\1/.exec(body)?.[2] ?? null;
    if (url === null) {
      continue;
    }
    repositories.push({
      index: match.index,
      repository: {
        url,
        name: /\bname\s*(?:=|\s)\s*(["'])([^"']+)\1/.exec(body)?.[2] ?? null,
        credentials: /\bcredentials\b/.test(body),
      },
    });
  }
  return repositories
    .sort((a: { index: number }, b: { index: number }): number => a.index - b.index)
    .map(
      (entry: { repository: GradleRepositoryDeclaration }): GradleRepositoryDeclaration =>
        entry.repository,
    );
}

/**
 * Reads the text inside a braced block.
 * @param source The script.
 * @param open The index of the block's `{`.
 * @returns Returns the text between the braces.
 */
function blockBody(source: string, open: number): string {
  let depth: number = 0;
  for (let index: number = open; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1;
    } else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, index);
      }
    }
  }
  return source.slice(open + 1);
}

/**
 * Reads a settings script's projects: every `include` (Groovy or Kotlin, one path or several, with or
 * without a leading colon), any `project(':x').projectDir = file('…')` that moves one, and
 * `rootProject.name`.
 * @param script The settings script.
 * @returns Returns the projects.
 */
export function parseGradleSettings(script: string): GradleSettings {
  const source: string = stripComments(script);
  const projects: Map<string, string> = new Map<string, string>();
  for (const match of source.matchAll(/\binclude(?![A-Za-z])\s*(?:\(([^)]*)\)|([^\n]*))/g)) {
    const args: string = match[1] ?? match[2] ?? '';
    for (const quoted of args.matchAll(/(["'])([^"']+)\1/g)) {
      const projectPath: string = quoted[2].startsWith(':') ? quoted[2] : `:${quoted[2]}`;
      projects.set(projectPath, projectPath.slice(1).split(':').join('/'));
    }
  }
  for (const match of source.matchAll(
    /\bproject\(\s*(["'])(:[^"']+)\1\s*\)\.projectDir\s*=\s*(?:file|File)\(\s*(["'])([^"']+)\3\s*\)/g,
  )) {
    projects.set(match[2], match[4]);
  }
  const rootName: string | null =
    /\brootProject\.name\s*=\s*(["'])([^"']+)\1/.exec(source)?.[2] ?? null;
  return { rootName, projects };
}

/**
 * Reads a `gradle.properties` file (Java properties: `key=value` or `key: value`, `#` and `!` comments).
 * Continuation lines are not read; a version is never written over two lines.
 * @param text The file's text.
 * @returns Returns the properties.
 */
export function parseProperties(text: string): ReadonlyMap<string, string> {
  const properties: Map<string, string> = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line: string = raw.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith('!')) {
      continue;
    }
    const match: RegExpExecArray | null = /^([^=:\s]+)\s*[=:]\s*(.*)$/.exec(line);
    if (match !== null) {
      properties.set(match[1], match[2].trim());
    }
  }
  return properties;
}

/**
 * Reads the simple variables a script assigns a literal string to — `val kotlinVersion = "2.0.0"`,
 * `def jacksonVersion = '2.17.0'`, `ext.springVersion = '6.1.0'`, `set("x", "1.0")` — so a
 * `"g:a:$kotlinVersion"` can be resolved. A value that is itself computed is not read.
 * @param script The script.
 * @returns Returns the variables.
 */
export function parseScriptVariables(script: string): ReadonlyMap<string, string> {
  const source: string = stripComments(script);
  const variables: Map<string, string> = new Map<string, string>();
  for (const match of source.matchAll(
    /(?:^|[\s;{])(?:(?:val|var|def|String)\s+|ext\.|extra\[\s*["'])?([A-Za-z_]\w*)(?:["']\s*\])?\s*=\s*(["'])([^"'$\n]*)\2/g,
  )) {
    if (!variables.has(match[1])) {
      variables.set(match[1], match[3]);
    }
  }
  for (const match of source.matchAll(/\bset\(\s*(["'])(\w+)\1\s*,\s*(["'])([^"'$\n]*)\3\s*\)/g)) {
    if (!variables.has(match[2])) {
      variables.set(match[2], match[4]);
    }
  }
  return variables;
}

/**
 * Replaces `$name` and `${name}` in a string with the variables' values, leaving any it cannot.
 * @param value The string.
 * @param variables The variables in force.
 * @returns Returns the string with what could be resolved, resolved.
 */
export function interpolateGradle(value: string, variables: ReadonlyMap<string, string>): string {
  return value.replace(
    /\$\{([\w.]+)\}|\$([A-Za-z_]\w*)/g,
    (match: string, braced: string | undefined, bare: string | undefined): string => {
      const name: string = (braced ?? bare ?? '').replace(/^(?:project|rootProject|ext)\./, '');
      return variables.get(name) ?? match;
    },
  );
}

/**
 * Reads a `gradle.lockfile`: one `group:artifact:version=configurations` line per resolved module.
 * @param text The file's text.
 * @returns Returns each module's locked version, by `group:artifact`.
 */
export function parseGradleLockfile(text: string): ReadonlyMap<string, string> {
  const locked: Map<string, string> = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line: string = raw.trim();
    const match: RegExpExecArray | null = /^([^:#=\s]+):([^:=\s]+):([^:=\s]+)=/.exec(line);
    if (match !== null) {
      locked.set(`${match[1]}:${match[2]}`, match[3]);
    }
  }
  return locked;
}
