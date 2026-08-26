import { FileOperationResult } from '../api/workspace-channels';
import { trashOrRemove } from './trash-or-remove';

/**
 * Builds a deletion step that succeeds, recording the paths it was asked for.
 * @param calls The list to record calls into.
 * @returns Returns the step.
 */
function succeeds(calls: string[]): (target: string) => Promise<void> {
  return (target: string): Promise<void> => {
    calls.push(target);
    return Promise.resolve();
  };
}

/**
 * Builds a deletion step that fails, recording the paths it was asked for.
 * @param calls The list to record calls into.
 * @param message The rejection's message.
 * @returns Returns the step.
 */
function fails(calls: string[], message: string): (target: string) => Promise<void> {
  return (target: string): Promise<void> => {
    calls.push(target);
    return Promise.reject(new Error(message));
  };
}

describe('trash-or-remove', () => {
  describe('trashOrRemove', () => {
    it('movesTheEntryToTheTrash_andSaysSo', async () => {
      const trashed: string[] = [];
      const removed: string[] = [];

      const result: FileOperationResult = await trashOrRemove(
        '/work/notes.md',
        succeeds(trashed),
        succeeds(removed),
      );

      expect(result).toEqual({ success: true, path: '/work/notes.md', trashed: true });
      expect(trashed).toEqual(['/work/notes.md']);
      expect(removed).toEqual([]);
    });

    it('doesNotRemovePermanently_whenTheEntryWasTrashed', async () => {
      // The fallback is a fallback, not a second pass: trashing and then unlinking would destroy the
      // very copy the Trash was holding, turning the recoverable path into the unrecoverable one.
      const removed: string[] = [];

      await trashOrRemove('/work/notes.md', succeeds([]), succeeds(removed));

      expect(removed).toEqual([]);
    });

    it('removesPermanently_whenThereIsNoTrashToMoveItTo', async () => {
      // Network volumes and some container mounts have no trash. The user confirmed a delete, so the
      // delete still happens.
      const removed: string[] = [];

      const result: FileOperationResult = await trashOrRemove(
        '/mnt/share/build',
        fails([], 'Failed to move item to trash'),
        succeeds(removed),
      );

      expect(result).toEqual({ success: true, path: '/mnt/share/build', trashed: false });
      expect(removed).toEqual(['/mnt/share/build']);
    });

    it('reportsTheFallbackAsNotTrashed_soCallersCanWordItHonestly', async () => {
      // A confirmation that promised the Trash, in front of an operation that removed permanently, is
      // a lie the user only discovers when they go looking for the file. The flag is what lets the
      // caller tell the truth afterwards.
      const result: FileOperationResult = await trashOrRemove(
        '/mnt/share/build',
        fails([], 'no trash here'),
        succeeds([]),
      );

      expect(result.success).toBe(true);
      expect(result.trashed).toBe(false);
    });

    it('failsWithTheRemovalsMessage_whenNeitherPathWorks', async () => {
      const result: FileOperationResult = await trashOrRemove(
        '/work/locked',
        fails([], 'no trash here'),
        fails([], 'EACCES: permission denied'),
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('EACCES: permission denied');
      expect(result.path).toBeUndefined();
    });
  });
});
