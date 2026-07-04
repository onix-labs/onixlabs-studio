import { TestBed } from '@angular/core/testing';

import { EditorTerminals } from './editor-terminals';

describe('EditorTerminals', () => {
  let editorTerminals: EditorTerminals;

  beforeEach(() => {
    editorTerminals = TestBed.inject(EditorTerminals);
  });

  it('isVisible_whenNoState_returnsFalse', () => {
    expect(editorTerminals.isVisible('tab-1')).toBe(false);
  });

  it('show_whenCalled_marksVisibleAndMounted', () => {
    editorTerminals.show('tab-1');
    expect(editorTerminals.isVisible('tab-1')).toBe(true);
    expect(editorTerminals.isMounted('tab-1')).toBe(true);
  });

  it('toggle_whenVisible_hidesButStaysMounted', () => {
    editorTerminals.show('tab-1');
    editorTerminals.toggle('tab-1');
    expect(editorTerminals.isVisible('tab-1')).toBe(false);
    expect(editorTerminals.isMounted('tab-1')).toBe(true);
  });

  it('hide_whenVisible_hidesButStaysMounted', () => {
    editorTerminals.show('tab-1');
    editorTerminals.hide('tab-1');
    expect(editorTerminals.isVisible('tab-1')).toBe(false);
    expect(editorTerminals.isMounted('tab-1')).toBe(true);
  });

  it('toggleLayout_whenStacked_switchesToSideBySide', () => {
    expect(editorTerminals.layout('tab-1')).toBe('stacked');
    editorTerminals.toggleLayout('tab-1');
    expect(editorTerminals.layout('tab-1')).toBe('side-by-side');
  });

  it('queueCommand_whenCalled_showsPanelAndStoresPending', () => {
    editorTerminals.queueCommand('tab-1', 'node run.js');
    expect(editorTerminals.isVisible('tab-1')).toBe(true);
    expect(editorTerminals.pending('tab-1')).toBe('node run.js');
  });

  it('takePending_whenPending_returnsAndClears', () => {
    editorTerminals.queueCommand('tab-1', 'node run.js');
    expect(editorTerminals.takePending('tab-1')).toBe('node run.js');
    expect(editorTerminals.pending('tab-1')).toBeNull();
  });
});
