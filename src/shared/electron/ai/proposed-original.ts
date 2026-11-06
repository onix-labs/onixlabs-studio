import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { decodeText } from '@shared/electron/text-encoding';

/**
 * Reads the file a change put to the user would alter, as it is now, for the diff on the prompt (#891).
 *
 * Read here rather than by the renderer because the path is a model's choice, and the renderer may only
 * read what the user opened (#1174). The text goes only as far as the prompt, never back to the model,
 * and a harness asks only for targets its write confinement has already let through.
 * @param filePath The file, as the tool named it.
 * @param workspaceRoot The run's workspace, which a relative path is taken from.
 * @returns Returns the file's text, or null when it does not exist or cannot be read as a file.
 */
export async function proposedOriginal(
  filePath: string,
  workspaceRoot: string | null,
): Promise<string | null> {
  const resolved: string = path.resolve(workspaceRoot ?? '', filePath);
  try {
    // A FIFO blocks until a writer appears and a device reads without end: only a file is a document.
    if (!(await fs.stat(resolved)).isFile()) {
      return null;
    }
    return decodeText(await fs.readFile(resolved), {}).text;
  } catch {
    return null;
  }
}
