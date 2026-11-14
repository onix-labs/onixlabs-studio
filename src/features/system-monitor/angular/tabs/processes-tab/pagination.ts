/**
 * The most page numbers shown before the run is shortened with gaps.
 */
const ALL_PAGES: number = 7;

/**
 * Works out the page numbers a pager shows: every page when there are few, otherwise the first and
 * last pages, a run around the current one, and a gap (null) for each stretch left out — `1 2 3 4 5 …
 * 14` near the start, `1 … 6 7 8 … 14` in the middle.
 * @param current The current page, from 1.
 * @param count The number of pages.
 * @returns Returns the page numbers in order, with null for each gap.
 */
export function pageNumbers(current: number, count: number): readonly (number | null)[] {
  if (count <= ALL_PAGES) {
    return Array.from(
      { length: Math.max(0, count) },
      (_: unknown, index: number): number => index + 1,
    );
  }
  const page: number = Math.min(count, Math.max(1, current));
  if (page <= 4) {
    return [1, 2, 3, 4, 5, null, count];
  }
  if (page >= count - 3) {
    return [1, null, count - 4, count - 3, count - 2, count - 1, count];
  }
  return [1, null, page - 1, page, page + 1, null, count];
}
