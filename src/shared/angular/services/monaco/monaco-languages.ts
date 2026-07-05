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
 * Gets the supported languages with their display names, sorted by display name.
 * @returns Returns the supported languages.
 */
export function supportedLanguages(): readonly LanguageInfo[] {
  const ids: ReadonlySet<string> = new Set<string>(Object.values(EXTENSION_TO_LANGUAGE));
  return Array.from(
    ids,
    (id: string): LanguageInfo => ({ id, name: LANGUAGE_NAMES[id] ?? id }),
  ).sort((a: LanguageInfo, b: LanguageInfo): number => a.name.localeCompare(b.name));
}
