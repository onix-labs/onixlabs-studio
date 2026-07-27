import {
  CONFINED_WRITE_TOOLS,
  isWriteDenied,
  isWriteWithinRoots,
  writeTargetPath,
} from './write-confinement';

/**
 * A POSIX-style workspace root used as the baseline for the confinement tests.
 */
const ROOT: string = '/home/dev/project';

describe('write-confinement', () => {
  describe('CONFINED_WRITE_TOOLS', () => {
    it('CONFINED_WRITE_TOOLS_coversTheBuiltInFileWriters', () => {
      expect(CONFINED_WRITE_TOOLS).toEqual(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
    });
  });

  describe('writeTargetPath', () => {
    it('writeTargetPath_whenFilePathPresent_returnsIt', () => {
      expect(writeTargetPath({ file_path: '/home/dev/project/a.ts', content: 'x' })).toBe(
        '/home/dev/project/a.ts',
      );
    });

    it('writeTargetPath_whenNotebookPath_returnsIt', () => {
      expect(writeTargetPath({ notebook_path: '/home/dev/project/nb.ipynb' })).toBe(
        '/home/dev/project/nb.ipynb',
      );
    });

    it('writeTargetPath_whenNoPathOrNotAnObject_returnsNull', () => {
      expect(writeTargetPath({ content: 'no path here' })).toBeNull();
      expect(writeTargetPath({ file_path: '' })).toBeNull();
      expect(writeTargetPath(null)).toBeNull();
      expect(writeTargetPath('a string')).toBeNull();
    });
  });

  describe('isWriteWithinRoots', () => {
    it('isWriteWithinRoots_whenInsideRoot_isTrue', () => {
      expect(isWriteWithinRoots('/home/dev/project/src/a.ts', [ROOT])).toBe(true);
    });

    it('isWriteWithinRoots_whenExactlyTheRoot_isTrue', () => {
      expect(isWriteWithinRoots('/home/dev/project', [ROOT])).toBe(true);
    });

    it('isWriteWithinRoots_whenRelativePath_resolvesAgainstTheRoot', () => {
      expect(isWriteWithinRoots('src/a.ts', [ROOT])).toBe(true);
    });

    it('isWriteWithinRoots_whenAbsoluteOutsideRoot_isFalse', () => {
      expect(isWriteWithinRoots('/etc/passwd', [ROOT])).toBe(false);
      expect(isWriteWithinRoots('/home/dev/other/a.ts', [ROOT])).toBe(false);
    });

    it('isWriteWithinRoots_whenDotDotEscape_isFalse', () => {
      expect(isWriteWithinRoots('/home/dev/project/../secret', [ROOT])).toBe(false);
      expect(isWriteWithinRoots('../../etc/shadow', [ROOT])).toBe(false);
    });

    it('isWriteWithinRoots_whenSiblingPrefixCollision_isFalse', () => {
      // A sibling whose name merely starts with the root's basename must not count as inside.
      expect(isWriteWithinRoots('/home/dev/project-evil/a.ts', [ROOT])).toBe(false);
    });

    it('isWriteWithinRoots_whenInsideAnAdditionalDirectory_isTrue', () => {
      const extra: string = '/home/dev/shared';
      expect(isWriteWithinRoots('/home/dev/shared/lib.ts', [ROOT, extra])).toBe(true);
    });

    it('isWriteWithinRoots_whenNoRoots_isUnconfined', () => {
      // An empty root set means confinement is inactive (e.g. a no-workspace run).
      expect(isWriteWithinRoots('/etc/passwd', [])).toBe(true);
    });
  });

  describe('isWriteDenied', () => {
    it('isWriteDenied_whenEmptyList_isFalse', () => {
      expect(isWriteDenied('/home/dev/project/.env', [], ROOT)).toBe(false);
    });

    it('isWriteDenied_whenPathSegmentMatches_isTrue', () => {
      expect(isWriteDenied('/home/dev/project/.git/config', ['.git'], ROOT)).toBe(true);
      expect(isWriteDenied('/home/dev/project/.env', ['.env'], ROOT)).toBe(true);
      expect(isWriteDenied('/home/dev/project/a/secrets/key.pem', ['secrets'], ROOT)).toBe(true);
    });

    it('isWriteDenied_whenRelativeTarget_resolvesAgainstBase', () => {
      expect(isWriteDenied('.env', ['.env'], ROOT)).toBe(true);
      expect(isWriteDenied('src/app.ts', ['.env'], ROOT)).toBe(false);
    });

    it('isWriteDenied_whenSegmentIsOnlyAPartialMatch_isFalse', () => {
      // `.environment` must not match the `.env` deny segment.
      expect(isWriteDenied('/home/dev/project/.environment', ['.env'], ROOT)).toBe(false);
    });

    it('isWriteDenied_whenAbsoluteEntryContainsTarget_isTrue', () => {
      expect(isWriteDenied('/home/dev/project/.git/x', ['/home/dev/project/.git'], ROOT)).toBe(
        true,
      );
      expect(isWriteDenied('/home/dev/project/src/a.ts', ['/home/dev/project/.git'], ROOT)).toBe(
        false,
      );
    });
  });
});
