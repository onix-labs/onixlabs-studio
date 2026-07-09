import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { StatusBar } from '@shared/angular/services/status-bar/status-bar';
import { computeMarkdownStats, MarkdownStatus } from './markdown-status';

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

describe('MarkdownStatus', () => {
  let markdownStatus: MarkdownStatus;
  let statusBar: StatusBar;

  beforeEach(() => {
    markdownStatus = TestBed.inject(MarkdownStatus);
    statusBar = TestBed.inject(StatusBar);
  });

  it('publish_whenContentSet_showsWordCountAndReadTimeTrailing', () => {
    markdownStatus.publish('tab-1', 'the quick brown fox');
    TestBed.inject(ApplicationRef).tick();
    expect(statusBar.trailing().map((segment) => segment.text)).toEqual(['4 words', '1 min read']);
  });

  it('publish_whenSingleWord_usesSingularLabel', () => {
    markdownStatus.publish('tab-1', 'solo');
    TestBed.inject(ApplicationRef).tick();
    expect(statusBar.trailing()[0]?.text).toBe('1 word');
  });

  it('publish_whenEmpty_showsZeroWordsAndOmitsReadTime', () => {
    markdownStatus.publish('tab-1', '   ');
    TestBed.inject(ApplicationRef).tick();
    expect(statusBar.trailing().map((segment) => segment.text)).toEqual(['0 words']);
  });

  it('clear_whenOwningTab_removesSegments', () => {
    markdownStatus.publish('tab-1', 'hello world');
    TestBed.inject(ApplicationRef).tick();
    markdownStatus.clear('tab-1');
    TestBed.inject(ApplicationRef).tick();
    expect(statusBar.trailing().length).toBe(0);
  });

  it('clear_whenDifferentTab_leavesSegments', () => {
    markdownStatus.publish('tab-1', 'hello world');
    TestBed.inject(ApplicationRef).tick();
    markdownStatus.clear('tab-2');
    TestBed.inject(ApplicationRef).tick();
    expect(statusBar.trailing().length).toBe(2);
  });
});
