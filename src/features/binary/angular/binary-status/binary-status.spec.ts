import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { StatusBar, StatusSegment } from '@shared/angular/services/status-bar/status-bar';
import { BinaryContext, BinaryStatus } from './binary-status';

/**
 * Holds a baseline context the tests override per case.
 */
const CONTEXT: BinaryContext = {
  path: '/ws/blob.bin',
  offset: 10,
  selectionLength: 3,
  size: 100,
  format: 'PE · x64',
  dirty: false,
  insertMode: false,
};

describe('BinaryStatus', () => {
  let binaryStatus: BinaryStatus;
  let statusBar: StatusBar;

  /**
   * Flushes the service's projection effect so the status bar reflects the latest context.
   */
  function tick(): void {
    TestBed.inject(ApplicationRef).tick();
  }

  beforeEach(() => {
    binaryStatus = TestBed.inject(BinaryStatus);
    statusBar = TestBed.inject(StatusBar);
  });

  it('publish_showsPathAndFormatLeadingAndModeOffsetSelectionSizeTrailing', () => {
    binaryStatus.publish('tab-1', CONTEXT);
    tick();
    expect(statusBar.leading().map((segment: StatusSegment): string => segment.text)).toEqual([
      '/ws/blob.bin',
      'PE · x64',
    ]);
    expect(statusBar.trailing().map((segment: StatusSegment): string => segment.text)).toEqual([
      'OVR',
      'Offset 0xA',
      'Sel 3',
      '100 bytes',
    ]);
  });

  it('publish_whenDirtyAndInserting_marksThePathAndShowsInsertMode', () => {
    binaryStatus.publish('tab-1', { ...CONTEXT, dirty: true, insertMode: true });
    tick();
    expect(statusBar.leading()[0]?.text).toBe('/ws/blob.bin ●');
    expect(statusBar.trailing()[0]?.text).toBe('INS');
  });

  it('publish_whenThereIsNoCursor_showsAnEmptyOffset', () => {
    binaryStatus.publish('tab-1', { ...CONTEXT, offset: null });
    tick();
    expect(statusBar.trailing()[1]?.text).toBe('Offset —');
  });

  it('clear_whenOwningTab_removesSegments', () => {
    binaryStatus.publish('tab-1', CONTEXT);
    tick();
    binaryStatus.clear('tab-1');
    tick();
    expect(statusBar.leading().length + statusBar.trailing().length).toBe(0);
  });

  it('clear_whenDifferentTab_leavesSegments', () => {
    binaryStatus.publish('tab-1', CONTEXT);
    tick();
    binaryStatus.clear('tab-2');
    tick();
    expect(statusBar.leading().length).toBe(2);
  });
});
