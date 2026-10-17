/**
 * Rebuilds a value's regular expressions in another window's realm.
 *
 * Each window has its own `RegExp` constructor, and a check like Monaco's Monarch compiler makes —
 * `rule instanceof RegExp` — fails for a regular expression built in a different window: a grammar
 * defined by the application (in the main window) and registered with a Monaco instance loaded into a
 * child window is refused as "rules must start with a match string or regular expression". Cloning the
 * grammar with its expressions re-created by the target window's own constructor makes it that
 * window's, so the same definition serves every instance.
 *
 * Arrays and plain objects are walked; a regular expression is re-created from its source and flags;
 * anything else (strings, numbers, booleans, functions) is carried across as-is.
 * @param value The value to rebuild.
 * @param realm The window whose realm the result belongs to.
 * @returns Returns the rebuilt value.
 */
export function inRealm<T>(value: T, realm: Window): T {
  const RealmRegExp: typeof RegExp = (realm as unknown as { RegExp: typeof RegExp }).RegExp;
  const rebuild: (candidate: unknown) => unknown = (candidate: unknown): unknown => {
    if (candidate instanceof RegExp) {
      return new RealmRegExp(candidate.source, candidate.flags);
    }
    if (Array.isArray(candidate)) {
      return candidate.map(rebuild);
    }
    if (candidate !== null && typeof candidate === 'object') {
      const rebuilt: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(candidate as Record<string, unknown>)) {
        rebuilt[key] = rebuild(entry);
      }
      return rebuilt;
    }
    return candidate;
  };
  return rebuild(value) as T;
}
