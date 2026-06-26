import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { StatusBar } from '../status-bar/status-bar';
import { CodeContext, CodeStatus } from './code-status';

const CONTEXT: CodeContext = {
  path: '/home/user/file.ts',
  line: 3,
  column: 7,
  eol: 'LF',
  encoding: 'UTF-8',
};

describe('CodeStatus', () => {
  let codeStatus: CodeStatus;
  let statusBar: StatusBar;

  beforeEach(() => {
    codeStatus = TestBed.inject(CodeStatus);
    statusBar = TestBed.inject(StatusBar);
  });

  it('publish_whenContextSet_showsPathLeadingAndCaretEolEncodingTrailing', () => {
    codeStatus.publish('tab-1', CONTEXT);
    TestBed.inject(ApplicationRef).tick();
    expect(statusBar.leading()[0]?.text).toBe('/home/user/file.ts');
    expect(statusBar.trailing().map((segment) => segment.text)).toEqual([
      'Ln 3',
      'Col 7',
      'LF',
      'UTF-8',
    ]);
  });

  it('publish_whenPathIsNull_showsNewDocument', () => {
    codeStatus.publish('tab-1', { ...CONTEXT, path: null });
    TestBed.inject(ApplicationRef).tick();
    expect(statusBar.leading()[0]?.text).toBe('New Document');
  });

  it('clear_whenOwningTab_removesSegments', () => {
    codeStatus.publish('tab-1', CONTEXT);
    TestBed.inject(ApplicationRef).tick();
    codeStatus.clear('tab-1');
    TestBed.inject(ApplicationRef).tick();
    expect(statusBar.leading().length + statusBar.trailing().length).toBe(0);
  });

  it('clear_whenDifferentTab_leavesSegments', () => {
    codeStatus.publish('tab-1', CONTEXT);
    TestBed.inject(ApplicationRef).tick();
    codeStatus.clear('tab-2');
    TestBed.inject(ApplicationRef).tick();
    expect(statusBar.leading().length).toBe(1);
  });
});
