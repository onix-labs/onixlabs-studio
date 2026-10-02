import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { STUDIO_DIR, STUDIO_USER_IGNORE } from '@shared/api/studio';
import { logger } from '../logger';

/**
 * Atomically writes a file into a workspace's `.studio` folder: ensures the folder exists, seeds the
 * root `.gitignore` so per-developer files are never committed, writes to a temporary sibling, then
 * renames it over the target so a reader never sees a partial file.
 *
 * The caller confines `root` to an open workspace first; this writes wherever it is told.
 *
 * @param root The workspace root.
 * @param file The file name within `.studio`.
 * @param contents The file contents.
 */
export async function writeStudioFile(root: string, file: string, contents: string): Promise<void> {
  const directory: string = path.join(root, STUDIO_DIR);
  await fs.mkdir(directory, { recursive: true });
  await seedStudioGitignore(root);
  const target: string = path.join(directory, file);
  const temporary: string = `${target}.${process.pid}.tmp`;
  logger.trace('studio-files', `Atomically writing ${target} via ${temporary}`);
  await fs.writeFile(temporary, contents, 'utf8');
  await fs.rename(temporary, target);
}

/**
 * Reads and JSON-parses a file in a workspace's `.studio` folder.
 * @param root The workspace root.
 * @param file The file name within `.studio`.
 * @returns Returns the parsed value, or null when the file is missing or malformed, so the caller can
 * default it.
 */
export async function readStudioJson(root: string, file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(path.join(root, STUDIO_DIR, file), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Ensures the root `.gitignore` ignores the per-developer studio files, appending the pattern when it
 * is absent and leaving the file untouched when it is already present. A missing `.gitignore` is
 * created with just the pattern.
 * @param root The workspace root.
 */
export async function seedStudioGitignore(root: string): Promise<void> {
  const gitignore: string = path.join(root, '.gitignore');
  let existing: string;
  try {
    existing = await fs.readFile(gitignore, 'utf8');
  } catch {
    logger.debug('studio-files', `Creating ${gitignore} with studio ignore pattern`);
    await fs.writeFile(gitignore, `${STUDIO_USER_IGNORE}\n`, 'utf8');
    return;
  }
  const present: boolean = existing
    .split(/\r?\n/)
    .some((line: string): boolean => line.trim() === STUDIO_USER_IGNORE);
  if (present) {
    return;
  }
  const separator: string = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  await fs.appendFile(gitignore, `${separator}${STUDIO_USER_IGNORE}\n`, 'utf8');
}
