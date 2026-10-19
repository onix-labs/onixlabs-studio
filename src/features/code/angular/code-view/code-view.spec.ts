import { Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type * as MonacoApi from 'monaco-editor';
import type { MockInstance } from 'vitest';
import { EditorNavigation } from '@shared/angular/services/references/editor-navigation';
import {
  REFERENCES_HOST,
  ReferenceItem,
  ReferenceList,
  ReferencesHost,
} from '@shared/angular/services/references/reference-list';

import { CodeView } from './code-view';

describe('CodeView', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodeView],
    }).compileComponents();
  });

  // The component is constructed without running change detection so its Monaco editor is not booted:
  // Monaco loads its editor over an AMD loader script and browser layout APIs that the jsdom test
  // environment does not provide. This keeps the smoke test to the component's own wiring.
  it('create_whenConstructed_returnsComponent', () => {
    const fixture: ReturnType<typeof TestBed.createComponent<CodeView>> =
      TestBed.createComponent(CodeView);
    fixture.componentRef.setInput('tabId', 'tab-1');
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('referencesHost_showsTheListBesideTheEditor_goesToAChosenRow_andHidesOnClose', () => {
    // #1014: outside a workspace, the tab answers its editors' Find All References itself.
    const fixture: ReturnType<typeof TestBed.createComponent<CodeView>> =
      TestBed.createComponent(CodeView);
    fixture.componentRef.setInput('tabId', 'tab-1');
    const view: CodeView = fixture.componentInstance;
    const protectedView: {
      references: Signal<ReferenceList | null>;
      onReferenceChosen(item: ReferenceItem): void;
      onReferencesClosed(): void;
    } = view as unknown as {
      references: Signal<ReferenceList | null>;
      onReferenceChosen(item: ReferenceItem): void;
      onReferencesClosed(): void;
    };
    const editor: MonacoApi.editor.ICodeEditor = {
      focus: (): void => undefined,
    } as unknown as MonacoApi.editor.ICodeEditor;
    const item: ReferenceItem = {
      path: '/tmp/a.ts',
      range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 4 },
      preview: 'foo();',
    };
    const list: ReferenceList = {
      kind: 'references',
      symbol: 'foo',
      status: 'done',
      items: [item],
    };
    const goTo: MockInstance<EditorNavigation['goTo']> = vi
      .spyOn(TestBed.inject(EditorNavigation), 'goTo')
      .mockResolvedValue(undefined);

    expect(fixture.debugElement.injector.get<ReferencesHost>(REFERENCES_HOST)).toBe(view);
    view.openReferences(list, editor);
    expect(protectedView.references()).toBe(list);
    protectedView.onReferenceChosen(item);
    expect(goTo).toHaveBeenCalledWith(editor, item, true);
    protectedView.onReferencesClosed();
    expect(protectedView.references()).toBeNull();
  });
});
