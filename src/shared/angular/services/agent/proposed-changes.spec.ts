import { TestBed } from '@angular/core/testing';
import type { AiProposedChange } from '@shared/api/ai-types';
import type { ProposedDiff } from '@shared/angular/components/agent-cards/agent-edit-diff/proposed-diff';
import { ProposedChanges } from './proposed-changes';

describe('ProposedChanges', () => {
  /**
   * Builds the service over a file as the main process read it, or none.
   * @param content The file's content, or null when it does not exist.
   * @returns Returns something diffing a change against that file.
   */
  function over(content: string | null): {
    diffOf: (change: AiProposedChange) => Promise<ProposedDiff>;
  } {
    return {
      diffOf: (change: AiProposedChange): Promise<ProposedDiff> =>
        TestBed.inject(ProposedChanges).diffOf({ ...change, original: content }),
    };
  }

  it('diffsAWriteAgainstTheFileAsItIs', async () => {
    const diff: ProposedDiff = await over('a\n').diffOf({ path: '/r/a.ts', content: 'b\n' });

    expect(diff.newFile).toBe(false);
    expect([diff.additions, diff.deletions]).toEqual([1, 1]);
  });

  it('diffsAWriteOfANewFileAgainstNothing', async () => {
    const diff: ProposedDiff = await over(null).diffOf({ path: '/r/new.ts', content: 'b\n' });

    expect(diff.newFile).toBe(true);
  });

  it('appliesAnEditToTheFile_asTheAgentsToolWould', async () => {
    const diff: ProposedDiff = await over('one\ntwo\n').diffOf({
      path: '/r/a.ts',
      edits: [{ oldText: 'two', newText: '2' }],
    });

    expect(diff.fragmentsOnly).toBeUndefined();
    expect(diff.hunks[0].lines.some((line: { text: string }): boolean => line.text === 'one')).toBe(
      true,
    );
  });

  it('showsAnEditsTextAlone_whenTheFileNoLongerHasIt', async () => {
    const diff: ProposedDiff = await over('rewritten\n').diffOf({
      path: '/r/a.ts',
      edits: [{ oldText: 'two', newText: '2' }],
    });

    expect(diff.fragmentsOnly).toBe(true);
  });
});
