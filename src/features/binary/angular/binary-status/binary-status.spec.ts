import { describe, expect, it } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BinaryStatusStrip } from './binary-status-strip';
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

/**
 * Reads the rendered segment texts from one of the strip's two groups.
 * @param fixture The mounted status-strip fixture.
 * @param group The group to read: 0 for the leading group, 1 for the trailing one.
 * @returns Returns the segment texts in render order.
 */
function segmentsOf(fixture: ComponentFixture<BinaryStatusStrip>, group: number): string[] {
  const host: HTMLElement = fixture.nativeElement as HTMLElement;
  const groups: NodeListOf<Element> = host.querySelectorAll('.status-strip-segments__group');
  return [...(groups.item(group)?.querySelectorAll('.status-strip-segment') ?? [])].map(
    (element: Element): string => (element.textContent ?? '').trim(),
  );
}

describe('BinaryStatusStrip', () => {
  let status: BinaryStatus;
  let fixture: ComponentFixture<BinaryStatusStrip>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [BinaryStatus] });
    status = TestBed.inject(BinaryStatus);
    fixture = TestBed.createComponent(BinaryStatusStrip);
  });

  it('publish_showsPathAndFormatLeadingAndModeOffsetSelectionSizeTrailing', () => {
    status.publish(CONTEXT);
    fixture.detectChanges();

    expect(segmentsOf(fixture, 0)).toEqual(['/ws/blob.bin']);
    expect(segmentsOf(fixture, 1)).toEqual([
      'PE · x64',
      'OVR',
      'Offset 0000:000A',
      '3 bytes selected',
      '100 bytes',
    ]);
  });

  it('publish_whenDirtyAndInserting_marksThePathAndShowsInsertMode', () => {
    status.publish({ ...CONTEXT, dirty: true, insertMode: true });
    fixture.detectChanges();

    expect(segmentsOf(fixture, 0)[0]).toBe('/ws/blob.bin ●');
    expect(segmentsOf(fixture, 1)[1]).toBe('INS');
  });

  it('publish_whenThereIsNoCursor_showsAnEmptyOffset', () => {
    status.publish({ ...CONTEXT, offset: null });
    fixture.detectChanges();

    expect(segmentsOf(fixture, 1)[2]).toBe('Offset —');
  });

  it('showsNoSelection_whileOnlyTheCaretsByteIsSelected (#882)', () => {
    status.publish({ ...CONTEXT, selectionLength: 1 });
    fixture.detectChanges();

    expect(segmentsOf(fixture, 1)).toEqual(['PE · x64', 'OVR', 'Offset 0000:000A', '100 bytes']);
  });

  it('writesTheOffsetAsTheGutterDoes (#882)', () => {
    status.publish({ ...CONTEXT, offset: 0x1a5a40 });
    fixture.detectChanges();

    expect(segmentsOf(fixture, 1)[2]).toBe('Offset 001A:5A40');
  });

  it('describesALargeFile_byItsFriendlySizeThenTheExactCount (#882)', () => {
    status.publish({ ...CONTEXT, size: 2_271_456 });
    fixture.detectChanges();

    expect(segmentsOf(fixture, 1).at(-1)).toBe('2.2 MB (2,271,456 bytes)');
  });

  it('clear_whenCalled_removesEverySegment', () => {
    status.publish(CONTEXT);
    fixture.detectChanges();

    status.clear();
    fixture.detectChanges();

    expect(segmentsOf(fixture, 0)).toEqual([]);
    expect(segmentsOf(fixture, 1)).toEqual([]);
  });
});
