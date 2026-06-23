import { TestBed } from '@angular/core/testing';

import { CodeTerminals } from './code-terminals';

describe('CodeTerminals', () => {
  let codeTerminals: CodeTerminals;

  beforeEach(() => {
    codeTerminals = TestBed.inject(CodeTerminals);
  });

  it('isVisible_whenNoState_returnsFalse', () => {
    expect(codeTerminals.isVisible('tab-1')).toBe(false);
  });

  it('show_whenCalled_marksVisibleAndMounted', () => {
    codeTerminals.show('tab-1');
    expect(codeTerminals.isVisible('tab-1')).toBe(true);
    expect(codeTerminals.isMounted('tab-1')).toBe(true);
  });

  it('toggle_whenVisible_hidesButStaysMounted', () => {
    codeTerminals.show('tab-1');
    codeTerminals.toggle('tab-1');
    expect(codeTerminals.isVisible('tab-1')).toBe(false);
    expect(codeTerminals.isMounted('tab-1')).toBe(true);
  });

  it('hide_whenVisible_hidesButStaysMounted', () => {
    codeTerminals.show('tab-1');
    codeTerminals.hide('tab-1');
    expect(codeTerminals.isVisible('tab-1')).toBe(false);
    expect(codeTerminals.isMounted('tab-1')).toBe(true);
  });

  it('toggleLayout_whenStacked_switchesToSideBySide', () => {
    expect(codeTerminals.layout('tab-1')).toBe('stacked');
    codeTerminals.toggleLayout('tab-1');
    expect(codeTerminals.layout('tab-1')).toBe('side-by-side');
  });

  it('queueCommand_whenCalled_showsPanelAndStoresPending', () => {
    codeTerminals.queueCommand('tab-1', 'node run.js');
    expect(codeTerminals.isVisible('tab-1')).toBe(true);
    expect(codeTerminals.pending('tab-1')).toBe('node run.js');
  });

  it('takePending_whenPending_returnsAndClears', () => {
    codeTerminals.queueCommand('tab-1', 'node run.js');
    expect(codeTerminals.takePending('tab-1')).toBe('node run.js');
    expect(codeTerminals.pending('tab-1')).toBeNull();
  });
});
