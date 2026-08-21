import { describe, expect, it } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CodeStatusStrip } from './code-status-strip';
import { CodeContext, CodeStatus } from './code-status';

const CONTEXT: CodeContext = {
  path: '/home/user/file.ts',
  line: 3,
  column: 7,
  eol: 'LF',
  encoding: 'UTF-8',
};

/**
 * Reads the rendered segment texts from one of the strip's two groups.
 * @param fixture The mounted status-strip fixture.
 * @param group The group to read: 0 for the leading group, 1 for the trailing one.
 * @returns Returns the segment texts in render order.
 */
function segmentsOf(fixture: ComponentFixture<CodeStatusStrip>, group: number): string[] {
  const host: HTMLElement = fixture.nativeElement as HTMLElement;
  const groups: NodeListOf<Element> = host.querySelectorAll('.status-strip-segments__group');
  return [...(groups.item(group)?.querySelectorAll('.status-strip-segment') ?? [])].map(
    (element: Element): string => (element.textContent ?? '').trim(),
  );
}

describe('CodeStatusStrip', () => {
  let status: CodeStatus;
  let fixture: ComponentFixture<CodeStatusStrip>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [CodeStatus] });
    status = TestBed.inject(CodeStatus);
    fixture = TestBed.createComponent(CodeStatusStrip);
  });

  it('publish_whenContextSet_showsPathLeadingAndCaretEolEncodingTrailing', () => {
    status.publish(CONTEXT);
    fixture.detectChanges();

    expect(segmentsOf(fixture, 0)).toEqual(['/home/user/file.ts']);
    expect(segmentsOf(fixture, 1)).toEqual(['Ln 3', 'Col 7', 'LF', 'UTF-8']);
  });

  it('publish_whenPathIsNull_showsNewDocument', () => {
    status.publish({ ...CONTEXT, path: null });
    fixture.detectChanges();

    expect(segmentsOf(fixture, 0)).toEqual(['New Document']);
  });

  it('clear_whenCalled_removesEverySegment', () => {
    status.publish(CONTEXT);
    fixture.detectChanges();

    status.clear();
    fixture.detectChanges();

    expect(segmentsOf(fixture, 0)).toEqual([]);
    expect(segmentsOf(fixture, 1)).toEqual([]);
  });

  it('beforeAnyPublish_showsNothing', () => {
    fixture.detectChanges();

    expect(segmentsOf(fixture, 0)).toEqual([]);
    expect(segmentsOf(fixture, 1)).toEqual([]);
  });
});
