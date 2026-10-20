import { TestBed } from '@angular/core/testing';
import type { ReferenceList } from '@shared/angular/services/references/reference-list';
import { WorkspaceReferences, WorkspaceReferencesReveal } from './workspace-references';

/**
 * A list to reveal.
 */
const LIST: ReferenceList = { kind: 'references', symbol: 'Foo', status: 'done', items: [] };

describe('WorkspaceReferences (#1014)', () => {
  let references: WorkspaceReferences;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [WorkspaceReferences] });
    references = TestBed.inject(WorkspaceReferences);
  });

  it('available_onlyWhileAWorkspaceHasRegistered', () => {
    const reveal: WorkspaceReferencesReveal = (): void => undefined;

    expect(references.available()).toBe(false);
    references.register(reveal);
    expect(references.available()).toBe(true);
    references.unregister(reveal);
    expect(references.available()).toBe(false);
  });

  it('reveal_handsTheListToTheActiveWorkspace_andIsANoOpWithoutOne', () => {
    const shown: ReferenceList[] = [];
    expect((): void => references.reveal(LIST)).not.toThrow();

    references.register((list: ReferenceList): void => void shown.push(list));
    references.reveal(LIST);

    expect(shown).toEqual([LIST]);
  });

  it('unregister_whenGivenADifferentCallback_keepsTheCurrentOne', () => {
    const shown: ReferenceList[] = [];
    references.register((list: ReferenceList): void => void shown.push(list));

    references.unregister((): void => undefined);
    references.reveal(LIST);

    expect(shown).toEqual([LIST]);
  });

  it('open_goesThroughTheActiveWorkspacesOpener_andOpensNothingWithoutOne', async () => {
    const reveal: WorkspaceReferencesReveal = (): void => undefined;
    const opened: string[] = [];
    await expect(references.open('/ws/a.ts')).resolves.toBe(false);

    references.register(reveal, (path: string): Promise<boolean> => {
      opened.push(path);
      return Promise.resolve(true);
    });
    await expect(references.open('/ws/a.ts')).resolves.toBe(true);
    references.unregister(reveal);
    await expect(references.open('/ws/b.ts')).resolves.toBe(false);

    expect(opened).toEqual(['/ws/a.ts']);
  });
});
