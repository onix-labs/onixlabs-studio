import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type * as MonacoApi from 'monaco-editor';
import { ReferenceList, ReferencesHost, ReferencesWorkspace } from './reference-list';
import { ReferencesRouter } from './references-router';

/**
 * A finished list to route.
 */
const LIST: ReferenceList = { kind: 'references', symbol: 'Foo', status: 'done', items: [] };

/**
 * A stand-in workspace: whether it is active, and the lists it was shown.
 */
interface FakeWorkspace extends ReferencesWorkspace {
  readonly active: WritableSignal<boolean>;
  readonly shown: ReferenceList[];
}

/**
 * Builds a stand-in workspace.
 * @param active Whether a workspace is active.
 * @returns Returns it.
 */
function fakeWorkspace(active: boolean): FakeWorkspace {
  const state: WritableSignal<boolean> = signal<boolean>(active);
  const shown: ReferenceList[] = [];
  return {
    active: state,
    available: state.asReadonly(),
    shown,
    reveal: (list: ReferenceList): void => void shown.push(list),
  };
}

/**
 * Builds a stand-in tab host recording the lists it was shown.
 * @returns Returns the host and its record.
 */
function fakeHost(): ReferencesHost & { readonly shown: ReferenceList[] } {
  const shown: ReferenceList[] = [];
  return { shown, openReferences: (list: ReferenceList): void => void shown.push(list) };
}

describe('ReferencesRouter (#1014)', () => {
  const editor: MonacoApi.editor.ICodeEditor = {} as MonacoApi.editor.ICodeEditor;

  it('inAWorkspace_showsTheListInItsPanel_evenFromAnEditorInATabWithItsOwn', () => {
    const router: ReferencesRouter = TestBed.inject(ReferencesRouter);
    const workspace: FakeWorkspace = fakeWorkspace(true);
    const host: ReferencesHost & { readonly shown: ReferenceList[] } = fakeHost();
    router.useWorkspace(workspace);
    router.attach(editor, host);

    expect(router.answers(editor)).toBe(true);
    expect(router.show(LIST, editor)).toBe(true);

    expect(workspace.shown).toEqual([LIST]);
    expect(host.shown).toEqual([]);
  });

  it('outsideAWorkspace_showsTheListInTheTabTheEditorWasAttachedWith', () => {
    const router: ReferencesRouter = TestBed.inject(ReferencesRouter);
    const workspace: FakeWorkspace = fakeWorkspace(false);
    const host: ReferencesHost & { readonly shown: ReferenceList[] } = fakeHost();
    router.useWorkspace(workspace);
    router.attach(editor, host);

    expect(router.show(LIST, editor)).toBe(true);

    expect(host.shown).toEqual([LIST]);
    expect(workspace.shown).toEqual([]);
  });

  it('withNeither_answersNothing_andShowsNowhere', () => {
    const router: ReferencesRouter = TestBed.inject(ReferencesRouter);
    router.useWorkspace(fakeWorkspace(false));
    // An editor attached with no host — a workspace well document — has no panel of its own.
    router.attach(editor, null);

    expect(router.answers(editor)).toBe(false);
    expect(router.show(LIST, editor)).toBe(false);
  });

  it('detach_forgetsTheTab', () => {
    const router: ReferencesRouter = TestBed.inject(ReferencesRouter);
    const host: ReferencesHost & { readonly shown: ReferenceList[] } = fakeHost();

    const detach: () => void = router.attach(editor, host);
    expect(router.answers(editor)).toBe(true);
    detach();

    expect(router.answers(editor)).toBe(false);
  });
});
