import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { StatusBar } from '../status-bar/status-bar';
import { CodeStatus } from './code-status';

describe('CodeStatus', () => {
  let codeStatus: CodeStatus;
  let statusBar: StatusBar;

  beforeEach(() => {
    codeStatus = TestBed.inject(CodeStatus);
    statusBar = TestBed.inject(StatusBar);
  });

  it('setPosition_whenPositionSet_publishesLeadingSegment', () => {
    codeStatus.setPosition({ line: 3, column: 7 });
    TestBed.inject(ApplicationRef).tick();
    expect(statusBar.leading()[0]?.text).toBe('Ln 3, Col 7');
  });

  it('setPosition_whenCleared_publishesNoLeadingSegments', () => {
    codeStatus.setPosition({ line: 3, column: 7 });
    TestBed.inject(ApplicationRef).tick();
    codeStatus.setPosition(null);
    TestBed.inject(ApplicationRef).tick();
    expect(statusBar.leading().length).toBe(0);
  });
});
