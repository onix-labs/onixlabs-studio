import { FileOperationResult } from '@shared/api/workspace-channels';

/**
 * Deletes an entry to the operating system's trash, falling back to permanent removal.
 *
 * Trashing is the whole recovery story for deletes made from the app — there is no in-app undo stack,
 * so an unrecoverable recursive folder removal one pixel from Rename is not a command worth offering.
 * But `shell.trashItem` fails where no trash exists (network volumes, some container mounts, and on
 * entries the desktop environment refuses), and a delete the user explicitly confirmed should still
 * happen. So the fallback removes permanently and **says which of the two occurred**, letting the
 * caller word its report for what actually happened rather than for what it hoped would.
 *
 * The two operations arrive as parameters rather than being reached for directly, which keeps this
 * module free of both Electron and the filesystem: the decision can then be exercised on its own,
 * without dragging the workspace manager's whole import graph in behind it.
 * @param target The absolute path of the entry to delete.
 * @param trash Moves the entry to the operating system's trash.
 * @param remove Removes the entry permanently, recursively for a folder.
 * @returns Returns the result describing success and whether the entry was trashed.
 */
export async function trashOrRemove(
  target: string,
  trash: (target: string) => Promise<void>,
  remove: (target: string) => Promise<void>,
): Promise<FileOperationResult> {
  try {
    await trash(target);
    return { success: true, path: target, trashed: true };
  } catch {
    // No trash on this volume or platform; fall through to a permanent removal, which the result
    // reports so the caller never promises a Trash the entry did not reach.
  }
  try {
    await remove(target);
    return { success: true, path: target, trashed: false };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
