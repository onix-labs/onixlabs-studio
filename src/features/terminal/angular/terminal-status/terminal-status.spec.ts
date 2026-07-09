import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { StatusBar } from '@shared/angular/services/status-bar/status-bar';
import { Icon } from '@shared/angular/icons/icon';
import { TerminalStatus } from './terminal-status';

describe('TerminalStatus', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('should be created', () => {
    expect(TestBed.inject(TerminalStatus)).toBeTruthy();
  });

  it('setShell_whenGivenAShell_publishesATrailingStatusSegment', () => {
    const status: TerminalStatus = TestBed.inject(TerminalStatus);
    const statusBar: StatusBar = TestBed.inject(StatusBar);

    status.setShell('zsh');
    TestBed.inject(ApplicationRef).tick();

    expect(statusBar.trailing()).toEqual([
      { id: 'terminal-shell', text: 'zsh', icon: Icon.TERMINAL },
    ]);
  });

  it('setShell_whenCleared_removesTheTrailingSegment', () => {
    const status: TerminalStatus = TestBed.inject(TerminalStatus);
    const statusBar: StatusBar = TestBed.inject(StatusBar);

    status.setShell('zsh');
    TestBed.inject(ApplicationRef).tick();
    status.setShell(null);
    TestBed.inject(ApplicationRef).tick();

    expect(statusBar.trailing()).toEqual([]);
  });

  it('setAddress_whenGivenAnAddress_publishesALeadingStatusSegment', () => {
    const status: TerminalStatus = TestBed.inject(TerminalStatus);
    const statusBar: StatusBar = TestBed.inject(StatusBar);

    status.setAddress('john@machine:~/Foo/Bar');
    TestBed.inject(ApplicationRef).tick();

    expect(statusBar.leading()).toEqual([
      { id: 'terminal-address', text: 'john@machine:~/Foo/Bar' },
    ]);
  });

  it('setAddress_whenCleared_removesTheLeadingSegment', () => {
    const status: TerminalStatus = TestBed.inject(TerminalStatus);
    const statusBar: StatusBar = TestBed.inject(StatusBar);

    status.setAddress('john@machine:~');
    TestBed.inject(ApplicationRef).tick();
    status.setAddress(null);
    TestBed.inject(ApplicationRef).tick();

    expect(statusBar.leading()).toEqual([]);
  });
});
