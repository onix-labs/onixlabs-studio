import { describe, expect, it } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MarkdownStatusStrip } from './markdown-status-strip';
import { computeMarkdownStats, MarkdownStatus } from './markdown-status';

/**
 * Reads the rendered segment texts from the strip's trailing group.
 * @param fixture The mounted status-strip fixture.
 * @returns Returns the segment texts in render order.
 */
function trailingOf(fixture: ComponentFixture<MarkdownStatusStrip>): string[] {
  const host: HTMLElement = fixture.nativeElement as HTMLElement;
  const groups: NodeListOf<Element> = host.querySelectorAll('.status-strip-segments__group');
  return [...(groups.item(1)?.querySelectorAll('.status-strip-segment') ?? [])].map(
    (element: Element): string => (element.textContent ?? '').trim(),
  );
}

describe('computeMarkdownStats', () => {
  it('emptyOrWhitespace_countsZeroWordsAndZeroReadMinutes', () => {
    expect(computeMarkdownStats('')).toEqual({ words: 0, readMinutes: 0 });
    expect(computeMarkdownStats('   \n\t ')).toEqual({ words: 0, readMinutes: 0 });
  });

  it('countsWhitespaceSeparatedWords', () => {
    expect(computeMarkdownStats('the quick brown fox').words).toBe(4);
  });

  it('readTimeIsAtLeastOneMinuteForAnyNonEmptyDocument', () => {
    expect(computeMarkdownStats('one two three').readMinutes).toBe(1);
  });

  it('readTimeRoundsWordsAtTwoHundredPerMinute', () => {
    const content: string = Array.from({ length: 500 }, (): string => 'word').join(' ');
    expect(computeMarkdownStats(content).readMinutes).toBe(3);
  });
});

describe('MarkdownStatusStrip', () => {
  let status: MarkdownStatus;
  let fixture: ComponentFixture<MarkdownStatusStrip>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [MarkdownStatus] });
    status = TestBed.inject(MarkdownStatus);
    fixture = TestBed.createComponent(MarkdownStatusStrip);
  });

  it('publish_whenContentSet_showsWordCountAndReadTime', () => {
    status.publish('the quick brown fox');
    fixture.detectChanges();

    expect(trailingOf(fixture)).toEqual(['4 words', '1 min read']);
  });

  it('publish_whenSingleWord_usesSingularLabel', () => {
    status.publish('solo');
    fixture.detectChanges();

    expect(trailingOf(fixture)[0]).toBe('1 word');
  });

  it('publish_whenEmpty_showsZeroWordsAndOmitsReadTime', () => {
    status.publish('   ');
    fixture.detectChanges();

    expect(trailingOf(fixture)).toEqual(['0 words']);
  });

  it('clear_whenCalled_removesEverySegment', () => {
    status.publish('hello world');
    fixture.detectChanges();

    status.clear();
    fixture.detectChanges();

    expect(trailingOf(fixture)).toEqual([]);
  });
});
