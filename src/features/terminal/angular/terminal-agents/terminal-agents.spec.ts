import { TestBed } from '@angular/core/testing';

import { TerminalAgents } from './terminal-agents';

describe('TerminalAgents', () => {
  let terminalAgents: TerminalAgents;

  beforeEach(() => {
    terminalAgents = TestBed.inject(TerminalAgents);
  });

  it('isVisible_whenNoState_returnsFalse', () => {
    expect(terminalAgents.isVisible('tab-1')).toBe(false);
  });

  it('show_whenCalled_marksVisibleAndMounted', () => {
    terminalAgents.show('tab-1');
    expect(terminalAgents.isVisible('tab-1')).toBe(true);
    expect(terminalAgents.isMounted('tab-1')).toBe(true);
  });

  it('toggle_whenVisible_hidesButStaysMounted', () => {
    terminalAgents.show('tab-1');
    terminalAgents.toggle('tab-1');
    expect(terminalAgents.isVisible('tab-1')).toBe(false);
    expect(terminalAgents.isMounted('tab-1')).toBe(true);
  });

  it('hide_whenVisible_hidesButStaysMounted', () => {
    terminalAgents.show('tab-1');
    terminalAgents.hide('tab-1');
    expect(terminalAgents.isVisible('tab-1')).toBe(false);
    expect(terminalAgents.isMounted('tab-1')).toBe(true);
  });

  it('remove_whenCalled_dropsState', () => {
    terminalAgents.show('tab-1');
    terminalAgents.remove('tab-1');
    expect(terminalAgents.isVisible('tab-1')).toBe(false);
    expect(terminalAgents.isMounted('tab-1')).toBe(false);
  });
});
