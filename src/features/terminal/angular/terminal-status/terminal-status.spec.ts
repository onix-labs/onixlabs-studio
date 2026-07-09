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

  it('publish_whenGivenAShell_publishesATrailingStatusSegment', () => {
    const status: TerminalStatus = TestBed.inject(TerminalStatus);
    const statusBar: StatusBar = TestBed.inject(StatusBar);

    status.publish('tab-1', { address: null, shell: 'zsh' });
    TestBed.inject(ApplicationRef).tick();

    expect(statusBar.trailing()).toEqual([
      { id: 'terminal-shell', text: 'zsh', icon: Icon.TERMINAL },
    ]);
  });

  it('publish_whenGivenAnAddress_publishesALeadingStatusSegment', () => {
    const status: TerminalStatus = TestBed.inject(TerminalStatus);
    const statusBar: StatusBar = TestBed.inject(StatusBar);

    status.publish('tab-1', { address: 'john@machine:~/Foo/Bar', shell: 'zsh' });
    TestBed.inject(ApplicationRef).tick();

    expect(statusBar.leading()).toEqual([
      { id: 'terminal-address', text: 'john@machine:~/Foo/Bar' },
    ]);
  });

  it('clear_whenTheClearingTabOwnsTheStatus_removesTheSegments', () => {
    const status: TerminalStatus = TestBed.inject(TerminalStatus);
    const statusBar: StatusBar = TestBed.inject(StatusBar);

    status.publish('tab-1', { address: 'john@machine:~', shell: 'zsh' });
    TestBed.inject(ApplicationRef).tick();
    status.clear('tab-1');
    TestBed.inject(ApplicationRef).tick();

    expect(statusBar.leading()).toEqual([]);
    expect(statusBar.trailing()).toEqual([]);
  });

  it('clear_whenAnotherTabOwnsTheStatus_leavesTheActiveSegments', () => {
    const status: TerminalStatus = TestBed.inject(TerminalStatus);
    const statusBar: StatusBar = TestBed.inject(StatusBar);

    // The active terminal (tab-2) publishes, then the deactivating terminal (tab-1) clears. The clear
    // must not wipe the active terminal's contribution.
    status.publish('tab-2', { address: 'john@machine:~/Active', shell: 'zsh' });
    TestBed.inject(ApplicationRef).tick();
    status.clear('tab-1');
    TestBed.inject(ApplicationRef).tick();

    expect(statusBar.leading()).toEqual([
      { id: 'terminal-address', text: 'john@machine:~/Active' },
    ]);
    expect(statusBar.trailing()).toEqual([
      { id: 'terminal-shell', text: 'zsh', icon: Icon.TERMINAL },
    ]);
  });
});
