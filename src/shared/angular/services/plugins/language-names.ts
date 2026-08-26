/**
 * The display names of the languages Studio's tooling can serve, keyed by Monaco language identifier.
 * Shared so the Plugin Manager, the install offer and the settings tree all name a language the same
 * way — a language appears in all three, and "csharp" is not what any of them should show.
 */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  csharp: 'C#',
  cpp: 'C / C++',
  c: 'C',
  java: 'Java',
  kotlin: 'Kotlin',
  rust: 'Rust',
  go: 'Go',
};

/**
 * Gets a language's display name, falling back to the identifier itself for a language contributed by
 * something this list has never heard of.
 * @param language The Monaco language identifier.
 * @returns Returns the display name.
 */
export function languageDisplayName(language: string): string {
  return LANGUAGE_NAMES[language] ?? language;
}
