// Naming for the files of Studio's AI libraries (#1263): the persona's entries and imported skills are
// each filed under a path-safe slug of their name, made unique against what is already there. Keep
// this module platform-neutral (pure functions only).

/**
 * Turns free text into a path-safe slug: lower-case letters, digits and single hyphens, at most 64
 * characters, or empty when nothing usable is left.
 * @param text The text to slug.
 * @returns Returns the slug.
 */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

/**
 * Picks a name not already taken: the base itself, else the base with the first free `-2`, `-3`…
 * suffix, shortened so the result still fits a 64-character path segment.
 * @param base The preferred name; assumed already slugged.
 * @param taken Returns true for a name already in use.
 * @returns Returns the free name.
 */
export function uniqueName(base: string, taken: (name: string) => boolean): string {
  const root: string = base.length === 0 ? 'untitled' : base;
  if (!taken(root)) {
    return root;
  }
  for (let suffix: number = 2; ; suffix += 1) {
    const tail: string = `-${suffix}`;
    const candidate: string = `${root.slice(0, 64 - tail.length).replace(/-+$/g, '')}${tail}`;
    if (!taken(candidate)) {
      return candidate;
    }
  }
}
