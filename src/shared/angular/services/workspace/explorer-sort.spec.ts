import { explorerSorted } from './explorer-sort';

/**
 * An entry to sort.
 */
interface Entry {
  readonly name: string;
  readonly folder: boolean;
}

describe('explorerSorted', () => {
  const ENTRIES: readonly Entry[] = [
    { name: 'b', folder: true },
    { name: 'd', folder: true },
    { name: 'a', folder: false },
    { name: 'c', folder: false },
  ];

  /**
   * Sorts the entries under an order.
   * @param order The order.
   * @returns Returns their names.
   */
  function sorted(order: 'folders-first' | 'files-first' | 'mixed'): string {
    return explorerSorted<Entry>(
      ENTRIES,
      (entry: Entry): boolean => entry.folder,
      (a: Entry, b: Entry): number => a.name.localeCompare(b.name),
      order,
    )
      .map((entry: Entry): string => entry.name)
      .join('');
  }

  it('keepsFoldersFirst_asTheListingHasThem', () => {
    expect(sorted('folders-first')).toBe('bdac');
  });

  it('putsFilesFirst', () => {
    expect(sorted('files-first')).toBe('acbd');
  });

  it('mixesTheTwoByName', () => {
    expect(sorted('mixed')).toBe('abcd');
  });
});
