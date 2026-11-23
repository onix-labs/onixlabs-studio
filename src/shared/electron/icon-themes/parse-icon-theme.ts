import type { IconAssociations, IconSet } from '@shared/api/icon-theme';

/**
 * The associations a theme may name at most, across all its maps. Far beyond any real theme (Material's
 * few thousand), and there only so a hostile one cannot make the renderer hold millions.
 */
const MAX_ASSOCIATIONS: number = 50_000;

/**
 * The single pictures an icon set may name.
 */
const DEFAULT_KEYS: readonly (
  'file' | 'folder' | 'folderExpanded' | 'rootFolder' | 'rootFolderExpanded'
)[] = ['file', 'folder', 'folderExpanded', 'rootFolder', 'rootFolderExpanded'];

/**
 * Describes an icon theme document once validated: its pictures still named by path.
 */
export interface ParsedIconTheme {
  /**
   * Gets the associations over a dark background.
   */
  readonly dark: IconSet;

  /**
   * Gets the associations over a light background.
   */
  readonly light: IconSet;

  /**
   * Gets the paths of the pictures by identifier, relative to the document.
   */
  readonly picturePaths: ReadonlyMap<string, string>;
}

/**
 * Validates a VS Code file icon theme document.
 *
 * An association naming a picture that is not defined is dropped, so a lookup falls through to the next
 * rule as it does in VS Code. Real themes have them: Studio Icons sends dozens of extensions to a
 * `FOR_TEST_ONLY` that it never defines. Pictures drawn as font glyphs are not read yet, so they are
 * undefined too.
 * @param document The parsed JSON, untrusted.
 * @returns Returns the theme, or null when the document is not one.
 */
export function parseIconTheme(document: unknown): ParsedIconTheme | null {
  if (!isRecord(document) || !isRecord(document['iconDefinitions'])) {
    return null;
  }
  const picturePaths: Map<string, string> = new Map<string, string>();
  for (const [id, definition] of Object.entries(document['iconDefinitions'])) {
    if (isRecord(definition) && typeof definition['iconPath'] === 'string') {
      picturePaths.set(id, definition['iconPath']);
    }
  }
  const budget: Budget = { remaining: MAX_ASSOCIATIONS };
  const dark: IconSet = iconSet(document, picturePaths, budget);
  return {
    dark,
    light: overlaid(dark, iconSet(document['light'], picturePaths, budget)),
    picturePaths,
  };
}

/**
 * Counts down the associations still allowed.
 */
interface Budget {
  /**
   * Gets or sets how many remain.
   */
  remaining: number;
}

/**
 * Reads one set of associations.
 * @param source The object holding it, untrusted.
 * @param pictures The defined pictures.
 * @param budget The associations still allowed.
 * @returns Returns the set, empty when there is none.
 */
function iconSet(source: unknown, pictures: ReadonlyMap<string, string>, budget: Budget): IconSet {
  const record: Record<string, unknown> = isRecord(source) ? source : {};
  const defaults: Partial<Record<(typeof DEFAULT_KEYS)[number], string>> = {};
  for (const key of DEFAULT_KEYS) {
    const id: unknown = record[key];
    if (typeof id === 'string' && pictures.has(id)) {
      defaults[key] = id;
    }
  }
  const read: (key: string) => IconAssociations = (key: string): IconAssociations =>
    associations(record[key], pictures, budget);
  return {
    ...defaults,
    fileNames: read('fileNames'),
    fileExtensions: read('fileExtensions'),
    languageIds: read('languageIds'),
    folderNames: read('folderNames'),
    folderNamesExpanded: read('folderNamesExpanded'),
  };
}

/**
 * Reads one map of associations, its names lower-cased since they match whatever their case.
 * @param source The map, untrusted.
 * @param pictures The defined pictures.
 * @param budget The associations still allowed.
 * @returns Returns the associations.
 */
function associations(
  source: unknown,
  pictures: ReadonlyMap<string, string>,
  budget: Budget,
): IconAssociations {
  const entries: (readonly [string, string])[] = [];
  for (const [name, id] of Object.entries(isRecord(source) ? source : {})) {
    if (typeof id === 'string' && pictures.has(id) && budget.remaining > 0) {
      budget.remaining -= 1;
      entries.push([name.toLowerCase(), id]);
    }
  }
  return Object.fromEntries(entries);
}

/**
 * Lays one set over another: what it names wins, and the other fills in the rest.
 * @param base The set beneath.
 * @param over The set on top.
 * @returns Returns the combined set.
 */
function overlaid(base: IconSet, over: IconSet): IconSet {
  return {
    ...base,
    ...over,
    fileNames: { ...base.fileNames, ...over.fileNames },
    fileExtensions: { ...base.fileExtensions, ...over.fileExtensions },
    languageIds: { ...base.languageIds, ...over.languageIds },
    folderNames: { ...base.folderNames, ...over.folderNames },
    folderNamesExpanded: { ...base.folderNamesExpanded, ...over.folderNamesExpanded },
  };
}

/**
 * Determines whether a value is a plain JSON object.
 * @param value The value.
 * @returns Returns true when it is.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
