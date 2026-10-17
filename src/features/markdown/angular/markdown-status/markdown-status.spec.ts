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
  return groupOf(fixture, 1);
}

/**
 * Reads the rendered segment texts from the strip's leading group.
 * @param fixture The mounted status-strip fixture.
 * @returns Returns the segment texts in render order.
 */
function leadingOf(fixture: ComponentFixture<MarkdownStatusStrip>): string[] {
  return groupOf(fixture, 0);
}

/**
 * Reads the rendered segment texts from one of the strip's groups.
 * @param fixture The mounted status-strip fixture.
 * @param index The group: 0 for leading, 1 for trailing.
 * @returns Returns the segment texts in render order.
 */
function groupOf(fixture: ComponentFixture<MarkdownStatusStrip>, index: number): string[] {
  const host: HTMLElement = fixture.nativeElement as HTMLElement;
  const groups: NodeListOf<Element> = host.querySelectorAll('.status-strip-segments__group');
  return [...(groups.item(index)?.querySelectorAll('.status-strip-segment') ?? [])].map(
    (element: Element): string => (element.textContent ?? '').trim(),
  );
}

/**
 * Publishes a saved document with no selection.
 * @param status The status to publish to.
 * @param text The document's text.
 * @param selectedText The selected text, if any.
 */
function publish(status: MarkdownStatus, text: string, selectedText: string | null = null): void {
  status.publish({ path: '/notes/todo.md', text, selectedText });
}

describe('computeMarkdownStats', () => {
  it('emptyOrWhitespace_countsZeroWordsAndZeroReadMinutes', () => {
    expect(computeMarkdownStats('')).toEqual({ words: 0, characters: 0, readMinutes: 0 });
    expect(computeMarkdownStats('   \n\t ').words).toBe(0);
    expect(computeMarkdownStats('   \n\t ').readMinutes).toBe(0);
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

describe('computeMarkdownStats characters (#882)', () => {
  it('countsWhatAReaderSees_spacesIncluded_lineBreaksNot', () => {
    expect(computeMarkdownStats('ab c').characters).toBe(4);
    expect(computeMarkdownStats('ab\nc').characters).toBe(3);
  });

  it('countsAnEmojiOrAccentedLetterAsOneCharacter', () => {
    expect(computeMarkdownStats('👍🏽').characters).toBe(1);
    expect(computeMarkdownStats('e\u0301').characters).toBe(1);
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
    publish(status, 'the quick brown fox');
    fixture.detectChanges();

    expect(trailingOf(fixture)).toEqual(['4 words', '19 characters', '1 min read']);
  });

  it('publish_whenSingleWord_usesSingularLabel', () => {
    publish(status, 'solo');
    fixture.detectChanges();

    expect(trailingOf(fixture)[0]).toBe('1 word');
  });

  it('publish_whenEmpty_showsZeroWordsAndOmitsReadTime', () => {
    publish(status, '');
    fixture.detectChanges();

    expect(trailingOf(fixture)).toEqual(['0 words', '0 characters']);
  });

  it('clear_whenCalled_removesEverySegment', () => {
    publish(status, 'hello world');
    fixture.detectChanges();

    status.clear();
    fixture.detectChanges();

    expect(trailingOf(fixture)).toEqual([]);
    expect(leadingOf(fixture)).toEqual([]);
  });

  it('namesTheDocumentsPath_orNewDocument_likeTheCodeEditor (#882)', () => {
    publish(status, 'hello');
    fixture.detectChanges();
    expect(leadingOf(fixture)).toEqual(['/notes/todo.md']);

    status.publish({ path: null, text: 'hello', selectedText: null });
    fixture.detectChanges();
    expect(leadingOf(fixture)).toEqual(['New Document']);
  });

  it('countsTheSelectionsWords_ofTheWhole (#882)', () => {
    publish(status, 'the quick brown fox', 'quick brown');
    fixture.detectChanges();

    expect(trailingOf(fixture)[0]).toBe('2 of 4 words');
  });

  it('groupsLargeCountsForReading (#882)', () => {
    publish(status, 'word '.repeat(1200).trim());
    fixture.detectChanges();

    expect(trailingOf(fixture)[0]).toBe('1,200 words');
  });
});
