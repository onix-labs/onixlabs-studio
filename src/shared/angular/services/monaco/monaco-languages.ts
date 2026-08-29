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
  '.json': 'json',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'scss',
  '.less': 'less',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.py': 'python',
  '.rb': 'ruby',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'cpp',
  '.cs': 'csharp',
  '.go': 'go',
  '.rs': 'rust',
  '.php': 'php',
  '.sql': 'sql',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.ps1': 'powershell',
  '.swift': 'swift',
  '.kt': 'kotlin',
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
  rust: 'Rust',
  php: 'PHP',
  sql: 'SQL',
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
};

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
 * Resolves the Monaco language identifier for a file name.
 *
 * Prefer this to {@link languageForExtension} wherever the name is in hand: some files carry no
 * extension and are identified by their whole name, and an extension-only lookup calls those
 * plaintext. `Dockerfile` is the case that forced this — it is the canonical spelling, it has no
 * extension, and calling it plaintext means the editor never asks for a Dockerfile language server.
 * @param fileName The file name, with or without a path.
 * @returns Returns the Monaco language identifier, or `plaintext` when nothing matches.
 */
export function languageForFileName(fileName: string): string {
  const base: string = fileName.split(/[\\/]/).pop() ?? '';
  const named: string | undefined = FILENAME_TO_LANGUAGE[base.toLowerCase()];
  if (named !== undefined) {
    return named;
  }
  const dot: number = base.lastIndexOf('.');
  // A leading dot is the whole name of a dotfile, not an extension, so `.gitignore` is not an
  // extension of `gitignore`.
  return dot > 0 ? languageForExtension(base.slice(dot)) : DEFAULT_LANGUAGE;
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
