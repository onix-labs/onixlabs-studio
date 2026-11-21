import { associatedLanguage, type FileAssociation } from './file-associations';

/**
 * Describes a supported language and its display name.
 */
export interface LanguageInfo {
  /**
   * Gets the Monaco language identifier.
   */
  readonly id: string;

  /**
   * Gets the human-readable display name.
   */
  readonly name: string;
}

/**
 * Maps file extensions (lower-case, leading dot) to Monaco language identifiers.
 */
const EXTENSION_TO_LANGUAGE: Readonly<Record<string, string>> = {
  '.txt': 'plaintext',
  '.md': 'markdown',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  // ES-module and CommonJS TypeScript (#1213): a plain-text `.mts` never reached tsserver.
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.json': 'json',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'scss',
  '.less': 'less',
  '.xml': 'xml',
  // The XML family (#1068): .NET project and build files, XAML, and the XML formats that carry an
  // ending of their own. A `.csproj` opened as plain text was uncoloured and never offered to an XML
  // language server.
  '.csproj': 'xml',
  '.fsproj': 'xml',
  '.vbproj': 'xml',
  '.props': 'xml',
  '.targets': 'xml',
  '.nuspec': 'xml',
  '.resx': 'xml',
  '.xaml': 'xml',
  '.axaml': 'xml',
  '.slnx': 'xml',
  '.svg': 'xml',
  '.plist': 'xml',
  '.xsd': 'xml',
  '.xsl': 'xml',
  '.xslt': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.py': 'python',
  // A type stub, which ty and pyright read as Python, and a script run without a console window.
  '.pyi': 'python',
  '.pyw': 'python',
  '.rb': 'ruby',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.c++': 'cpp',
  '.h': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.hxx': 'cpp',
  '.h++': 'cpp',
  '.inl': 'cpp',
  '.ipp': 'cpp',
  '.tpp': 'cpp',
  '.cppm': 'cpp',
  '.ixx': 'cpp',
  '.cs': 'csharp',
  '.go': 'go',
  '.rs': 'rust',
  '.php': 'php',
  '.sql': 'sql',
  '.cypher': 'cypher',
  '.cql': 'cypher',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.ps1': 'powershell',
  '.swift': 'swift',
  '.kt': 'kotlin',
  // A Kotlin script, such as a Gradle build file (`build.gradle.kts`).
  '.kts': 'kotlin',
  '.r': 'r',
  '.lua': 'lua',
  '.pl': 'perl',
  '.dockerfile': 'dockerfile',
  '.graphql': 'graphql',
  '.vue': 'vue',
  '.svelte': 'svelte',
};

/**
 * Maps Monaco language identifiers to their display names.
 */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  plaintext: 'Plain Text',
  markdown: 'Markdown',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  xml: 'XML',
  yaml: 'YAML',
  python: 'Python',
  ruby: 'Ruby',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  go: 'Go',
  'go.mod': 'Go Module',
  'go.work': 'Go Workspace',
  rust: 'Rust',
  php: 'PHP',
  sql: 'SQL',
  cypher: 'Cypher',
  shell: 'Shell',
  powershell: 'PowerShell',
  swift: 'Swift',
  kotlin: 'Kotlin',
  r: 'R',
  lua: 'Lua',
  perl: 'Perl',
  dockerfile: 'Dockerfile',
  graphql: 'GraphQL',
  vue: 'Vue',
  svelte: 'Svelte',
};

/**
 * Maps whole file names to languages, for the files whose name *is* their type.
 *
 * An extension map cannot describe these: `Dockerfile` and `Makefile` carry no extension at all, and
 * resolving them by extension yields plaintext — which would leave the editor uncoloured and, more
 * importantly, mean no language server was ever asked for. Matched case-insensitively, and consulted
 * before the extension so `Dockerfile.prod` still resolves through its prefix below.
 */
const FILENAME_TO_LANGUAGE: Readonly<Record<string, string>> = {
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  // XML whatever their ending says (#1068): a `.config` is not XML as a rule, but these always are.
  'nuget.config': 'xml',
  'web.config': 'xml',
  'app.config': 'xml',
  'packages.config': 'xml',
  'directory.build.props': 'xml',
  'directory.build.targets': 'xml',
  'directory.packages.props': 'xml',
  // Go's module and workspace files (#1211), by the ids gopls reads them under: as plain text they never
  // reached gopls, so its go.mod lenses, hover and diagnostics could not appear.
  'go.mod': 'go.mod',
  'go.work': 'go.work',
};

/**
 * Holds the endings that say nothing certain about a file's language, so the file's content decides
 * (#1068): a `.config` is XML when it reads as XML, and plain text otherwise.
 */
const CONTENT_CHECKED_EXTENSIONS: ReadonlySet<string> = new Set<string>(['.config']);

/**
 * Holds the default language used when an extension is unknown.
 */
const DEFAULT_LANGUAGE: string = 'plaintext';

/**
 * Resolves the Monaco language identifier for a file extension.
 * @param extension The file extension, with or without a leading dot.
 * @returns Returns the Monaco language identifier, or `plaintext` when the extension is unknown.
 */
export function languageForExtension(extension: string): string {
  const lower: string = extension.toLowerCase();
  const normalised: string = lower.startsWith('.') ? lower : `.${lower}`;
  return EXTENSION_TO_LANGUAGE[normalised] ?? DEFAULT_LANGUAGE;
}

/**
 * Resolves the Monaco language identifier for a file: the one resolver every surface uses (#1068), so a
 * file colours, is offered to a language server, and is named the same way wherever it is opened.
 *
 * The rules, most specific first, the user's own before Studio's:
 * 1. The user's associations (Settings › Code › File Associations), most specific first: an exact
 *    path, an exact name (`Jenkinsfile`), a pattern over the path (`/work/ci/*.yml`), then a pattern
 *    over the name (`*.foo`). See {@link associatedLanguage}.
 * 2. A whole file name that is its type, matched case-insensitively: `Dockerfile`, `nuget.config`,
 *    `Directory.Build.props`.
 * 3. The file's ending: `.ts`, `.csproj`.
 * 4. For an ending that says nothing certain (`.config`), the content, when the caller has it: XML when
 *    its first non-blank character is `<`, after any byte-order mark. Without the content, plain text.
 *
 * Prefer this to {@link languageForExtension} wherever the name is in hand: an extension-only lookup
 * calls `Dockerfile` and `nuget.config` plain text, so the editor never asks for their language server.
 * @param fileName The file's path, or its name when it has none; a path lets path associations match.
 * @param content The file's text, when the caller has it, for the content check.
 * @param associations The user's associations, which win over every built-in rule.
 * @returns Returns the Monaco language identifier, or `plaintext` when nothing matches.
 */
export function languageForFileName(
  fileName: string,
  content?: string,
  associations: readonly FileAssociation[] = [],
): string {
  const associated: string | undefined = associatedLanguage(fileName, associations);
  if (associated !== undefined) {
    return associated;
  }
  const base: string = fileName.split(/[\\/]/).pop() ?? '';
  const named: string | undefined = FILENAME_TO_LANGUAGE[base.toLowerCase()];
  if (named !== undefined) {
    return named;
  }
  const dot: number = base.lastIndexOf('.');
  // A leading dot is the whole name of a dotfile, not an extension, so `.gitignore` is not an
  // extension of `gitignore`.
  if (dot <= 0) {
    return DEFAULT_LANGUAGE;
  }
  const extension: string = base.slice(dot).toLowerCase();
  if (CONTENT_CHECKED_EXTENSIONS.has(extension)) {
    return content !== undefined && readsAsXml(content) ? 'xml' : DEFAULT_LANGUAGE;
  }
  return languageForExtension(extension);
}

/**
 * Determines whether a file's text reads as XML: its first non-blank character, after any byte-order
 * mark, is `<` — an `<?xml` declaration or a root element such as `<configuration>`.
 * @param content The file's text.
 * @returns Returns true when the text reads as XML.
 */
export function readsAsXml(content: string): boolean {
  return /^\uFEFF?\s*</.test(content);
}

/**
 * Resolves the canonical file extension for a Monaco language identifier (the first extension
 * registered for it), used to suggest a file name when saving a new document.
 * @param language The Monaco language identifier.
 * @returns Returns the extension with a leading dot (`.txt` for plaintext), or an empty string for a
 * language with no registered extension.
 */
export function extensionForLanguage(language: string): string {
  for (const [extension, mapped] of Object.entries(EXTENSION_TO_LANGUAGE)) {
    if (mapped === language) {
      return extension;
    }
  }
  return '';
}

/**
 * Resolves a language named by a human (or a model) to a supported Monaco language identifier,
 * matching its id or its display name case-insensitively — so both `csharp` and `C#` resolve.
 *
 * Shared because more than one agent capability takes a language as free text: what the model may
 * write must not depend on which tool it reached for.
 * @param requested The requested language, as an id or a display name.
 * @returns Returns the Monaco language identifier, or null when it names no supported language.
 */
export function resolveLanguageId(requested: string): string | null {
  const normalised: string = requested.trim().toLowerCase();
  for (const language of supportedLanguages()) {
    if (language.id.toLowerCase() === normalised || language.name.toLowerCase() === normalised) {
      return language.id;
    }
  }
  return null;
}

/**
 * Gets the supported languages with their display names, sorted by display name.
 * @returns Returns the supported languages.
 */
export function supportedLanguages(): readonly LanguageInfo[] {
  const ids: ReadonlySet<string> = new Set<string>(Object.values(EXTENSION_TO_LANGUAGE));
  return Array.from(ids, (id: string): LanguageInfo => ({
    id,
    name: LANGUAGE_NAMES[id] ?? id,
  })).sort((a: LanguageInfo, b: LanguageInfo): number => a.name.localeCompare(b.name));
}
