import { Stats } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import * as path from 'node:path';
import type { IconTheme } from '@shared/api/icon-theme';
import { logger } from '../logger';
import { ParsedIconTheme, parseIconTheme } from './parse-icon-theme';

/**
 * The largest JSON document read, in bytes.
 */
const MAX_DOCUMENT_BYTES: number = 8 * 1024 * 1024;

/**
 * The largest single picture read, in bytes.
 */
const MAX_PICTURE_BYTES: number = 256 * 1024;

/**
 * The most bytes of pictures read for one theme.
 */
const MAX_TOTAL_PICTURE_BYTES: number = 24 * 1024 * 1024;

/**
 * The kinds of picture a theme may draw with.
 */
const PICTURE_TYPES: ReadonlyMap<string, string> = new Map<string, string>([
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
]);

/**
 * Loads the first icon theme an unpacked VS Code extension contributes.
 *
 * The extension is untrusted, and none of its code is read: only its `package.json`, the theme document
 * that names, and the pictures that does, each within the extension's own folder once links are
 * followed. A picture that cannot be read is left out, and what it stood for falls through to the next
 * rule.
 * @param extension The extension's folder.
 * @returns Returns the theme, or null when there is none to load.
 */
export async function loadIconTheme(extension: string): Promise<IconTheme | null> {
  try {
    const root: string = await realpath(extension);
    const contribution: Contribution | null = contributionOf(
      await readJson(path.join(root, 'package.json'), root),
    );
    if (contribution === null) {
      logger.warn('IconTheme', `No icon theme in ${root}`);
      return null;
    }
    const document: string = path.resolve(root, contribution.path);
    const parsed: ParsedIconTheme | null = parseIconTheme(await readJson(document, root));
    if (parsed === null) {
      logger.warn('IconTheme', `Not an icon theme: ${document}`);
      return null;
    }
    const pictures: Record<string, string> = await readPictures(
      parsed.picturePaths,
      path.dirname(document),
      root,
    );
    logger.info(
      'IconTheme',
      `Loaded '${contribution.label}' with ${Object.keys(pictures).length} of ${parsed.picturePaths.size} picture(s)`,
    );
    return { label: contribution.label, dark: parsed.dark, light: parsed.light, pictures };
  } catch (error: unknown) {
    logger.warn('IconTheme', `Could not load an icon theme from ${extension}`, error);
    return null;
  }
}

/**
 * Describes where an extension says its icon theme is.
 */
interface Contribution {
  /**
   * Gets the name it is listed by.
   */
  readonly label: string;

  /**
   * Gets the document's path, relative to the extension.
   */
  readonly path: string;
}

/**
 * Reads the first icon theme an extension's manifest contributes.
 * @param manifest The manifest, untrusted.
 * @returns Returns the contribution, or null when there is none.
 */
function contributionOf(manifest: unknown): Contribution | null {
  const themes: unknown = (
    manifest as { contributes?: { iconThemes?: unknown } } | null | undefined
  )?.contributes?.iconThemes;
  const first: unknown = Array.isArray(themes) ? themes[0] : undefined;
  if (typeof first !== 'object' || first === null) {
    return null;
  }
  const { label, path: document }: { label?: unknown; path?: unknown } = first;
  return typeof label === 'string' && typeof document === 'string'
    ? { label, path: document }
    : null;
}

/**
 * Reads the pictures a theme names.
 * @param paths The pictures' paths by identifier.
 * @param base The folder the paths are relative to.
 * @param root The folder they must stay within.
 * @returns Returns the pictures by identifier, as `data:` URIs.
 */
async function readPictures(
  paths: ReadonlyMap<string, string>,
  base: string,
  root: string,
): Promise<Record<string, string>> {
  const pictures: [string, string][] = [];
  let total: number = 0;
  // In turn, so the total is known before each read rather than after all of them.
  for (const [id, relative] of paths) {
    const type: string | undefined = PICTURE_TYPES.get(path.extname(relative).toLowerCase());
    if (type === undefined) {
      continue;
    }
    try {
      const bytes: Buffer = await readWithin(
        path.resolve(base, relative),
        root,
        Math.min(MAX_PICTURE_BYTES, MAX_TOTAL_PICTURE_BYTES - total),
      );
      total += bytes.length;
      pictures.push([id, `data:${type};base64,${bytes.toString('base64')}`]);
    } catch (error: unknown) {
      logger.debug('IconTheme', `Left out picture '${id}'`, error);
    }
  }
  return Object.fromEntries(pictures);
}

/**
 * Reads a JSON document within a folder.
 * @param target The document.
 * @param root The folder it must be within.
 * @returns Returns the parsed document.
 */
async function readJson(target: string, root: string): Promise<unknown> {
  const text: string = (await readWithin(target, root, MAX_DOCUMENT_BYTES)).toString('utf8');
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}

/**
 * Reads a file that must be within a folder, once links are followed, and no larger than a limit.
 * @param target The file.
 * @param root The folder, as it really is.
 * @param limit The most bytes to read.
 * @returns Returns the file's bytes.
 * @throws Error When it lies outside the folder, is not a file, or is too large.
 */
async function readWithin(target: string, root: string, limit: number): Promise<Buffer> {
  const real: string = await realpath(target);
  const relative: string = path.relative(root, real);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Outside the theme: ${target}`);
  }
  const stats: Stats = await stat(real);
  if (!stats.isFile() || stats.size > limit) {
    throw new Error(`Not a file of at most ${limit} bytes: ${target}`);
  }
  return readFile(real);
}
