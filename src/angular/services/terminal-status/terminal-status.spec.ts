import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { StatusBar } from '../status-bar/status-bar';
import { TerminalStatus } from './terminal-status';

describe('TerminalStatus', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('should be created', () => {
    expect(TestBed.inject(TerminalStatus)).toBeTruthy();
  });

  it('setCwd_whenGivenAPath_publishesATrailingStatusSegment', () => {
    const status: TerminalStatus = TestBed.inject(TerminalStatus);
    const statusBar: StatusBar = TestBed.inject(StatusBar);

    status.setCwd('/home/user/project');
    TestBed.inject(ApplicationRef).tick();

    expect(statusBar.trailing()).toEqual([
      { id: 'terminal-cwd', text: '/home/user/project', icon: 'ti ti-folder' },
    ]);
  });

  it('setCwd_whenCleared_removesTheTrailingSegment', () => {
    const status: TerminalStatus = TestBed.inject(TerminalStatus);
    const statusBar: StatusBar = TestBed.inject(StatusBar);

    status.setCwd('/home/user/project');
    TestBed.inject(ApplicationRef).tick();
    status.setCwd(null);
    TestBed.inject(ApplicationRef).tick();

    expect(statusBar.trailing()).toEqual([]);
  });
});
