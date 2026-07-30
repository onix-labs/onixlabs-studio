/**
 * Maps a run configuration's `providerKind` to the name its group wears in the Configure dialog's
 * tree. The stored kind is an identifier (`dotnet`, `cpp`), which reads poorly as a heading.
 *
 * Note that a kind is a PROJECT SYSTEM, not a build tool: Gradle and Maven projects both carry `jvm`
 * and so share one group. Splitting them would need an axis the configuration model does not have.
 */
const KIND_LABELS: Readonly<Record<string, string>> = {
  node: 'Node',
  dotnet: '.NET',
  jvm: 'JVM',
  python: 'Python',
  rust: 'Rust',
  go: 'Go',
  cpp: 'C++',
};

/**
 * Resolves the display name for a provider kind, falling back to the raw kind capitalised so a
 * project system added later still reads as a heading rather than disappearing.
 * @param kind The provider kind as stored on the configuration.
 * @returns Returns the group's display name.
 */
export function runConfigurationKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? (kind.length === 0 ? 'Other' : kind[0].toUpperCase() + kind.slice(1));
}
