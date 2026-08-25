import { blobSpec, INDEX_REVISION } from './git-manager';

describe('git-manager', () => {
  describe('blobSpec', () => {
    it('joinsARealRevisionToItsPath', () => {
      expect(blobSpec('HEAD', 'README.md')).toBe('HEAD:README.md');
      expect(blobSpec('abc123', 'src/app/main.ts')).toBe('abc123:src/app/main.ts');
    });

    it('keepsARevisionExpressionIntact', () => {
      // A commit's diff reads its parent as `<hash>^` when the parent is not named outright.
      expect(blobSpec('abc123^', 'README.md')).toBe('abc123^:README.md');
    });

    it('doesNotDoubleTheSeparator_whenTheRevisionIsTheIndex', () => {
      // The index blob is `:path` — the revision is the empty name before the colon, so writing the
      // colon again yields `::path`, which git rejects as an ambiguous argument. That rejection was
      // indistinguishable from an absent blob, so every working-tree diff silently lost the side that
      // came from the index: unstaged files read as wholly added, staged ones as wholly deleted.
      expect(blobSpec(INDEX_REVISION, 'README.md')).toBe(':README.md');
      expect(blobSpec(INDEX_REVISION, 'README.md')).not.toBe('::README.md');
    });

    it('leavesAPathWithColonsAlone_soOnlyTheSeparatorIsAdded', () => {
      // The path is git's operand, not part of the revision expression; nothing here rewrites it.
      expect(blobSpec('HEAD', 'weird:name.ts')).toBe('HEAD:weird:name.ts');
    });
  });
});
