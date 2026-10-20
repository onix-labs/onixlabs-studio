import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { MockInstance } from 'vitest';
import { EditorNavigation } from '@shared/angular/services/references/editor-navigation';
import type {
  ReferenceItem,
  ReferenceList,
} from '@shared/angular/services/references/reference-list';
import { ActiveWorkspace } from '@shared/angular/services/workspace/active-workspace';
import { ReferencesPanel } from './references-panel';
import { ReferencesPanelState } from './references-panel-state';

/**
 * A reference in a file of the workspace.
 */
const ITEM: ReferenceItem = {
  path: '/root/src/app.ts',
  range: { startLineNumber: 8, startColumn: 15, endLineNumber: 8, endColumn: 18 },
  preview: 'const f = new Foo();',
};

describe('ReferencesPanel (#1014)', () => {
  let fixture: ComponentFixture<ReferencesPanel>;
  let state: ReferencesPanelState;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReferencesPanel],
      providers: [
        ReferencesPanelState,
        { provide: ActiveWorkspace, useValue: { rootPath: signal<string | null>('/root') } },
      ],
    }).compileComponents();
    state = TestBed.inject(ReferencesPanelState);
    fixture = TestBed.createComponent(ReferencesPanel);
    host = fixture.nativeElement as HTMLElement;
  });

  it('showsTheWorkspacesLatestList_itsFilesNamedRelativeToTheRoot', async () => {
    const list: ReferenceList = {
      kind: 'references',
      symbol: 'Foo',
      status: 'done',
      items: [ITEM],
    };

    state.show(list);
    await fixture.whenStable();

    expect(host.querySelector('.references-view__heading')?.textContent).toBe(
      '1 reference to Foo in 1 file',
    );
    expect(host.querySelector('.tree-name')?.textContent).toBe('src/app.ts');
  });

  it('choosingARow_opensItsFile_andSelectsTheReference', async () => {
    const goTo: MockInstance<EditorNavigation['goTo']> = vi
      .spyOn(TestBed.inject(EditorNavigation), 'goTo')
      .mockResolvedValue(undefined);
    state.show({ kind: 'references', symbol: 'Foo', status: 'done', items: [ITEM] });
    await fixture.whenStable();

    host.querySelectorAll<HTMLElement>('.tree-row')[1].click();

    expect(goTo).toHaveBeenCalledWith(null, ITEM, true);
  });
});
