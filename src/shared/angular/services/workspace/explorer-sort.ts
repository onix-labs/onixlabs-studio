import type { ExplorerSortOrder } from '@shared/angular/services/settings/settings-registry';

/**
 * Orders one folder's entries by Sort Order: folders ahead of files, files ahead of folders, or the two
 * mixed by name. Within folders and within files the given order stands.
 * @param entries The entries, in name order with the folders first.
 * @param isFolder Determines whether an entry is a folder.
 * @param compare Compares two entries by name, for Mixed.
 * @param order Sort Order.
 * @returns Returns the entries in display order.
 */
export function explorerSorted<T>(
  entries: readonly T[],
  isFolder: (entry: T) => boolean,
  compare: (a: T, b: T) => number,
  order: ExplorerSortOrder,
): readonly T[] {
  if (order === 'folders-first') {
    return entries;
  }
  if (order === 'mixed') {
    return [...entries].sort(compare);
  }
  return [...entries.filter((entry: T): boolean => !isFolder(entry)), ...entries.filter(isFolder)];
}
