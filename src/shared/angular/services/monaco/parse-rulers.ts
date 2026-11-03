/**
 * Reads the Rulers setting into columns: whole positive numbers, in order, with repeats and anything
 * else left out, so a half-typed value draws what it can rather than nothing.
 * @param rulers The setting's text, such as `80, 120`.
 * @returns Returns the columns.
 */
export function parseRulers(rulers: string): readonly number[] {
  const columns: Set<number> = new Set<number>();
  for (const part of rulers.split(',')) {
    const column: number = Number(part.trim());
    if (Number.isInteger(column) && column > 0) {
      columns.add(column);
    }
  }
  return [...columns].sort((left: number, right: number): number => left - right);
}
