import type { IconAssociations, IconSet } from '@shared/api/icon-theme';

/**
 * Maps the extensions many themes predate onto the ones they stand in for: a theme with nothing for
 * `.slnx` still draws a solution as one.
 */
const STAND_INS: Readonly<Record<string, string>> = { slnx: 'sln', slnf: 'sln' };

/**
 * Describes a file or folder to match an icon to.
 */
export interface IconSubject {
  /**
   * Gets its path, or just its name.
   */
  readonly path: string;

  /**
   * Gets what it is.
   */
  readonly kind: 'file' | 'folder' | 'root';

  /**
   * Gets a value indicating whether a folder is expanded.
   */
  readonly expanded?: boolean;

  /**
   * Gets a file's language, or undefined when it has none.
   */
  readonly language?: string;

  /**
   * Gets a value indicating whether only a rule naming the subject counts, not a set's default for
   * every file or folder.
   */
  readonly named?: boolean;
}

/**
 * Matches a file or folder to a picture, as VS Code does: a file by its name, then its longest
 * extension, then its language, then the set's default; a folder by its name, then the default. A rule
 * that names the parent folder too beats one that doesn't.
 * @param set The associations.
 * @param subject The file or folder.
 * @returns Returns the picture's identifier, or undefined when nothing matches.
 */
export function matchIcon(set: IconSet, subject: IconSubject): string | undefined {
  const segments: readonly string[] = subject.path.toLowerCase().split(/[\\/]/).filter(Boolean);
  const name: string = segments.at(-1) ?? '';
  const parent: string | undefined = segments.at(-2);
  if (subject.kind === 'file') {
    return (
      find(set.fileNames, name, parent) ??
      byExtension(set.fileExtensions, name, parent) ??
      (subject.language === undefined ? undefined : own(set.languageIds, subject.language)) ??
      (subject.named === true ? undefined : set.file)
    );
  }
  const expanded: boolean = subject.expanded === true;
  if (subject.kind === 'root') {
    const root: string | undefined = expanded
      ? (set.rootFolderExpanded ?? set.rootFolder)
      : set.rootFolder;
    if (root !== undefined) {
      return root;
    }
  }
  return (
    (expanded ? find(set.folderNamesExpanded, name, parent) : undefined) ??
    find(set.folderNames, name, parent) ??
    (subject.named === true
      ? undefined
      : expanded
        ? (set.folderExpanded ?? set.folder)
        : set.folder)
  );
}

/**
 * Finds a file's picture by its extension, the longest first: `d.ts` before `ts`. A dotfile's name is
 * its extension, so `.gitignore` matches `gitignore`.
 * @param extensions The associations.
 * @param name The file's name.
 * @param parent Its folder's name, if known.
 * @returns Returns the picture's identifier, or undefined when nothing matches.
 */
function byExtension(
  extensions: IconAssociations,
  name: string,
  parent: string | undefined,
): string | undefined {
  for (let dot: number = name.indexOf('.'); dot !== -1; dot = name.indexOf('.', dot + 1)) {
    const extension: string = name.slice(dot + 1);
    const found: string | undefined =
      find(extensions, extension, parent) ??
      (Object.hasOwn(STAND_INS, extension)
        ? find(extensions, STAND_INS[extension], parent)
        : undefined);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/**
 * Finds an association, preferring one that names the parent folder.
 * @param associations The associations.
 * @param name The name.
 * @param parent The parent folder's name, if known.
 * @returns Returns the picture's identifier, or undefined when nothing matches.
 */
function find(
  associations: IconAssociations,
  name: string,
  parent: string | undefined,
): string | undefined {
  return (
    (parent === undefined ? undefined : own(associations, `${parent}/${name}`)) ??
    own(associations, name)
  );
}

/**
 * Reads an association, never one inherited: a file may be named `constructor`.
 * @param associations The associations.
 * @param name The name.
 * @returns Returns the picture's identifier, or undefined.
 */
function own(associations: IconAssociations, name: string): string | undefined {
  return Object.hasOwn(associations, name) ? associations[name] : undefined;
}
