/**
 * Renames a solution folder inside an `.slnx` file.
 *
 * The whole edit is a string rewrite, and lives apart from the .NET project system that calls it so it
 * can be tested without loading that file — and its `execFile`/`fs` import graph — into the coverage
 * denominator, the same reason {@link import('./item-tree')} lives apart from its caller.
 *
 * `.slnx` encodes a folder's hierarchy in a slash-delimited `Name` attribute (`/Core/Abstractions/`)
 * rather than in the XML nesting alone, so renaming one segment means rewriting that segment in the
 * folder's own `Name` and in every folder declared beneath it. A `<Project Path>` is a *filesystem*
 * path and is never touched.
 */

/**
 * Builds a matcher for a `<Folder>` tag that captures its `Name` attribute value. Built fresh per use
 * rather than shared, so no `lastIndex` survives from one scan into the next.
 * @returns Returns the matcher.
 */
function folderTag(): RegExp {
  return /<Folder\b([^>]*?)\bName="([^"]*)"/g;
}

/**
 * The outcome of a rename: the rewritten file content, or the reason it was refused.
 */
export type SolutionFolderRename =
  | {
      /**
       * Identifies a successful rewrite.
       */
      readonly ok: true;

      /**
       * Gets the rewritten file content.
       */
      readonly content: string;
    }
  | {
      /**
       * Identifies a refused rename.
       */
      readonly ok: false;

      /**
       * Gets the reason the rename was refused.
       */
      readonly error: string;
    };

/**
 * Normalises a solution folder path to a leading slash and no trailing slash, so the paths a `.slnx`
 * writes in either style compare as one.
 * @param value The raw folder path.
 * @returns Returns the normalised path, or an empty string when the path names no folder.
 */
export function normaliseFolderPath(value: string): string {
  const trimmed: string = value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return trimmed.length === 0 ? '' : `/${trimmed}`;
}

/**
 * Renames a solution folder within `.slnx` content.
 *
 * Refuses rather than guesses: an empty or separator-bearing name, a folder the file does not declare,
 * and a name already taken by a sibling are all rejected with nothing written. The sibling case matters
 * most — two folders sharing a path are read back as one node, so an unchecked rename would silently
 * fuse them, and there is no undo.
 * @param content The `.slnx` file content.
 * @param folderPath The slash-delimited path of the folder to rename.
 * @param name The folder's new display name (one segment).
 * @returns Returns the rewritten content, or the reason the rename was refused.
 */
export function renameSolutionFolder(
  content: string,
  folderPath: string,
  name: string,
): SolutionFolderRename {
  const trimmed: string = name.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'A folder name cannot be empty.' };
  }
  if (/[/\\]/.test(trimmed)) {
    return { ok: false, error: 'A folder name cannot contain a path separator.' };
  }
  const target: string = normaliseFolderPath(folderPath);
  if (target === '') {
    return { ok: false, error: 'No folder was named.' };
  }
  const parent: string = target.slice(0, target.lastIndexOf('/'));
  const renamed: string = `${parent}/${trimmed}`;
  if (renamed === target) {
    return { ok: true, content };
  }

  const declared: Set<string> = new Set<string>();
  for (const match of content.matchAll(folderTag())) {
    declared.add(normaliseFolderPath(match[2]));
  }
  if (!declared.has(target)) {
    return { ok: false, error: `The solution declares no folder at '${target}'.` };
  }
  if (declared.has(renamed)) {
    return { ok: false, error: `A folder named '${trimmed}' is already here.` };
  }

  // Rewrite the target's own Name and every descendant's prefix, preserving each declaration's own
  // slash style rather than imposing one — the file is the user's to keep as they wrote it.
  const rewritten: string = content.replace(
    folderTag(),
    (whole: string, attributes: string, value: string): string => {
      const normalised: string = normaliseFolderPath(value);
      if (normalised !== target && !normalised.startsWith(`${target}/`)) {
        return whole;
      }
      const suffix: string = normalised.slice(target.length);
      const written: string = value.startsWith('/') ? renamed : renamed.slice(1);
      const trailing: string = value.endsWith('/') ? '/' : '';
      return `<Folder${attributes}Name="${written}${suffix}${trailing}"`;
    },
  );
  return { ok: true, content: rewritten };
}
