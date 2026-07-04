import { TestBed } from '@angular/core/testing';

import { CodeAgents } from './code-agents';

describe('CodeAgents', () => {
  let codeAgents: CodeAgents;

  beforeEach(() => {
    codeAgents = TestBed.inject(CodeAgents);
  });

  it('isVisible_whenNoState_returnsFalse', () => {
    expect(codeAgents.isVisible('tab-1')).toBe(false);
  });

  it('show_whenCalled_marksVisibleAndMounted', () => {
    codeAgents.show('tab-1');
    expect(codeAgents.isVisible('tab-1')).toBe(true);
    expect(codeAgents.isMounted('tab-1')).toBe(true);
  });

  it('toggle_whenVisible_hidesButStaysMounted', () => {
    codeAgents.show('tab-1');
    codeAgents.toggle('tab-1');
    expect(codeAgents.isVisible('tab-1')).toBe(false);
    expect(codeAgents.isMounted('tab-1')).toBe(true);
  });

  it('hide_whenVisible_hidesButStaysMounted', () => {
    codeAgents.show('tab-1');
    codeAgents.hide('tab-1');
    expect(codeAgents.isVisible('tab-1')).toBe(false);
    expect(codeAgents.isMounted('tab-1')).toBe(true);
  });

  it('remove_whenCalled_dropsState', () => {
    codeAgents.show('tab-1');
    codeAgents.remove('tab-1');
    expect(codeAgents.isVisible('tab-1')).toBe(false);
    expect(codeAgents.isMounted('tab-1')).toBe(false);
  });
});
