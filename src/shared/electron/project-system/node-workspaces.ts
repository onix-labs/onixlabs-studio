// Pure helpers for the Node/npm project system: reading the workspace patterns out of a parsed
// package.json. Kept free of Node imports so the parsing is unit-testable.

/**
 * Reads the npm/yarn workspace patterns from a parsed package.json: either the `workspaces` array
 * form or the `{ packages: [...] }` object form. Non-string entries are dropped.
 * @param manifest The parsed package.json content.
 * @returns Returns the workspace patterns, or an empty array when none are declared.
 */
export function parseWorkspacePatterns(manifest: unknown): readonly string[] {
  const workspaces: unknown = (manifest as { workspaces?: unknown } | null)?.workspaces;
  const raw: unknown =
    Array.isArray(workspaces) || workspaces === undefined || workspaces === null
      ? workspaces
      : (workspaces as { packages?: unknown }).packages;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((entry: unknown): entry is string => typeof entry === 'string');
}

/**
 * Splits a workspace pattern into the fixed directory prefix and whether it ends in a single-level
 * wildcard (`packages/*`). Patterns with wildcards anywhere else (double-star globs, or a star in
 * the middle of the path) are reported as unsupported so the caller can skip them rather than
 * mis-expand.
 * @param pattern The workspace pattern.
 * @returns Returns the prefix and wildcard flag, or null when the pattern is unsupported.
 */
export function splitWorkspacePattern(
  pattern: string,
): { prefix: string; wildcard: boolean } | null {
  const trimmed: string = pattern.replace(/\/+$/, '');
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.endsWith('/*')) {
    const prefix: string = trimmed.slice(0, -2);
    return prefix.includes('*') ? null : { prefix, wildcard: true };
  }
  return trimmed.includes('*') ? null : { prefix: trimmed, wildcard: false };
}
