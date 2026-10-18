import { ComponentFixture, TestBed } from '@angular/core/testing';
import type * as MonacoApi from 'monaco-editor';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { EditorSearch } from './editor-search';
import { EditorSearchPanel } from './editor-search-panel';
import { FakeCodeEditor, FakeTextModel } from './testing/fake-text-model';

describe('EditorSearchPanel (#1007)', () => {
  let fixture: ComponentFixture<EditorSearchPanel>;
  let search: EditorSearch;
  let editor: FakeCodeEditor;
  let host: HTMLElement;

  beforeEach(async () => {
    editor = new FakeCodeEditor(new FakeTextModel(['const todo = 1;']));
    search = new EditorSearch({
      mainEditor: (): MonacoApi.editor.ICodeEditor => editor.asEditor(),
      labelOf: (): string => 'main.ts',
    });
    await TestBed.configureTestingModule({
      imports: [EditorSearchPanel],
      providers: [{ provide: Notifications, useValue: { notify: (): void => undefined } }],
    }).compileComponents();
    fixture = TestBed.createComponent(EditorSearchPanel);
    fixture.componentRef.setInput('search', search);
    host = fixture.nativeElement as HTMLElement;
  });

  /**
   * Gets the strip's toggles' labels.
   * @returns Returns the labels, in order.
   */
  function toggles(): string[] {
    return Array.from(host.querySelectorAll<HTMLElement>('.search-view__toggle')).map(
      (toggle: HTMLElement): string => toggle.textContent.trim(),
    );
  }

  it('showsTheWorkspacesSearchView_inAToolPanel_seededAndSearchedByTheRequest', async () => {
    // Matthew, #1007: a code tab's find works as the workspace's does — the same strip, form and tree.
    search.open({ mode: 'replace', scope: 'file', seed: 'todo' }, null);
    await fixture.whenStable();

    expect(host.querySelector('.tool-panel__title')?.textContent).toBe('Find and Replace');
    expect(toggles()).toEqual(['Find', 'Replace']);
    expect(host.querySelector('.search-view__form app-dropdown')).not.toBeNull();
    expect(host.querySelectorAll('.search-view__results .tree-row').length).toBe(2);
  });

  it('overAReadOnlyEditor_isTitledFind_andOffersNoReplace', async () => {
    editor.readOnly = true;
    search.open({ mode: 'replace', scope: 'file' }, null);
    await fixture.whenStable();

    expect(host.querySelector('.tool-panel__title')?.textContent).toBe('Find');
    expect(toggles()).toEqual(['Find']);
  });

  it('escape_asksToClose', async () => {
    search.open({ mode: 'find', scope: 'file' }, null);
    await fixture.whenStable();
    let closed: number = 0;
    fixture.componentInstance.closed.subscribe((): void => void (closed += 1));

    host
      .querySelector('input')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(closed).toBe(1);
  });
});
