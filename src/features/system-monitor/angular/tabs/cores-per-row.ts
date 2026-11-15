/**
 * The core graphs a row holds when the count divides by neither 8 nor 6.
 */
const DEFAULT_PER_ROW: number = 8;

/**
 * Works out how many core graphs a row of a core grid holds, so every row is full: processors come in
 * multiples of 8 or 6, so 8 to a row where the count divides by 8, else 6 where it divides by 6, else
 * 8. A processor with 8 or fewer cores keeps them on one row.
 * @param count The number of cores.
 * @returns Returns the graphs to a row.
 */
export function coresPerRow(count: number): number {
  if (count <= DEFAULT_PER_ROW) {
    return Math.max(1, count);
  }
  if (count % 8 === 0) {
    return 8;
  }
  return count % 6 === 0 ? 6 : DEFAULT_PER_ROW;
}
