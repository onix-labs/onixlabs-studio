import { MergeToolReveal, MergeTools } from './merge-tools';

describe('MergeTools', () => {
  it('namesAMergeToolByItsFile_andRemembersWhichFileItShows', () => {
    const tools: MergeTools = new MergeTools();
    const id: string = tools.idForPath('/repo/a.ts');

    tools.put(id, '/repo/a.ts');

    expect(id).toBe('merge-tool:/repo/a.ts');
    expect(tools.pathOf(id)).toBe('/repo/a.ts');
    expect(tools.pathOf('merge-tool:/repo/other.ts')).toBeNull();
  });

  it('hearsTheSameConflictAskedForTwice_asTwoRequests', () => {
    const tools: MergeTools = new MergeTools();

    tools.requestReveal('merge-tool:/repo/a.ts', 2);
    const first: MergeToolReveal | null = tools.reveal();
    tools.requestReveal('merge-tool:/repo/a.ts', 2);
    const second: MergeToolReveal | null = tools.reveal();

    expect(first).toEqual({ panelId: 'merge-tool:/repo/a.ts', index: 2, sequence: 1 });
    expect(second?.sequence).toBe(2);
  });
});
