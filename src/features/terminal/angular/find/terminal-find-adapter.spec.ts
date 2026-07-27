import { ISearchOptions } from '@xterm/addon-search';
import { describe, expect, it } from 'vitest';
import { Terminal } from '@shared/angular/components/terminal/terminal';
import { FindQuery, FindResultItem } from '@shared/angular/components/find-panel/find-adapter';
import { TerminalFindAdapter } from './terminal-find-adapter';

/**
 * Records one call the adapter made into the pane's search addon.
 */
interface SearchCall {
  readonly kind: 'next' | 'previous' | 'clear';
  readonly term?: string;
  readonly options?: ISearchOptions;
}

/**
 * Drives a stubbed terminal pane and exposes the hooks the tests need: the calls the adapter made and
 * whether it is still subscribed to the addon's results.
 */
interface PaneHarness {
  readonly pane: Terminal;
  readonly calls: SearchCall[];
  subscribed(): boolean;
}

/**
 * Builds a stubbed terminal pane over the given buffer. The stub models the search addon's cursor: a
 * next/previous step moves the active match and reports it back through the results listener, exactly
 * as the real addon does, so the adapter's active-index tracking is exercised end to end.
 * @param lines The buffer's logical lines.
 * @param matchCount The number of matches the stubbed addon cycles through.
 * @returns Returns the harness.
 */
function createPane(lines: readonly string[], matchCount: number = 0): PaneHarness {
  const calls: SearchCall[] = [];
  let listener: ((activeIndex: number, count: number) => void) | null = null;
  let active: number = -1;

  const emit: () => void = (): void => {
    listener?.(active, matchCount);
  };

  const pane: Terminal = {
    bufferLines: (): readonly string[] => lines,
    searchNext: (term: string, options: ISearchOptions): void => {
      calls.push({ kind: 'next', term, options });
      active = matchCount === 0 ? -1 : (active + 1) % matchCount;
      emit();
    },
    searchPrevious: (term: string, options: ISearchOptions): void => {
      calls.push({ kind: 'previous', term, options });
      active = matchCount === 0 ? -1 : (active - 1 + matchCount) % matchCount;
      emit();
    },
    clearSearch: (): void => {
      calls.push({ kind: 'clear' });
      active = -1;
    },
    onSearchResults: (handler: (activeIndex: number, count: number) => void): (() => void) => {
      listener = handler;
      return (): void => {
        listener = null;
      };
    },
  } as unknown as Terminal;

  return { pane, calls, subscribed: (): boolean => listener !== null };
}

/**
 * Builds a find query, defaulting every option to off.
 * @param text The text or pattern to search for.
 * @param options The option overrides to apply.
 * @returns Returns the query.
 */
function query(text: string, options: Partial<Omit<FindQuery, 'text'>> = {}): FindQuery {
  return {
    text,
    caseSensitive: options.caseSensitive ?? false,
    wholeWord: options.wholeWord ?? false,
    regexp: options.regexp ?? false,
  };
}

describe('TerminalFindAdapter', () => {
  describe('capabilities', () => {
    it('supportsReplace_isFalse_becauseABufferIsReadOnly', () => {
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => null);

      expect(adapter.supportsReplace).toBe(false);
      expect(adapter.canUndo()).toBe(false);
    });

    it('replaceOperations_areInert', () => {
      const harness: PaneHarness = createPane(['alpha'], 1);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);
      adapter.setQuery(query('alpha'));
      const before: number = harness.calls.length;

      adapter.replace();
      adapter.replaceAll();
      adapter.undo();

      expect(harness.calls.length).toBe(before);
      expect(adapter.matches().length).toBe(1);
    });
  });

  describe('setQuery', () => {
    it('setQuery_whenPaneIsNotReady_clearsTheMatches', () => {
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => null);

      adapter.setQuery(query('alpha'));

      expect(adapter.matches()).toEqual([]);
      expect(adapter.activeIndex()).toBe(-1);
    });

    it('setQuery_whenTextIsEmpty_clearsTheMatchesAndTheHighlights', () => {
      const harness: PaneHarness = createPane(['alpha beta'], 1);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);

      adapter.setQuery(query(''));

      expect(adapter.matches()).toEqual([]);
      expect(harness.calls).toEqual([{ kind: 'clear' }]);
    });

    it('setQuery_whenTextMatches_buildsOneBasedMatchesWithPreviews', () => {
      const harness: PaneHarness = createPane(['alpha beta', 'gamma beta delta'], 2);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);

      adapter.setQuery(query('beta'));

      const matches: readonly FindResultItem[] = adapter.matches();
      expect(matches).toEqual([
        { line: 1, column: 7, before: 'alpha ', text: 'beta', after: '' },
        { line: 2, column: 7, before: 'gamma ', text: 'beta', after: ' delta' },
      ]);
    });

    it('setQuery_whenALineIsLong_trimsThePreviewToFortyCharactersPerSide', () => {
      const filler: string = 'x'.repeat(60);
      const harness: PaneHarness = createPane([`${filler}needle${filler}`], 1);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);

      adapter.setQuery(query('needle'));

      const [match]: readonly FindResultItem[] = adapter.matches();
      expect(match.before).toBe('x'.repeat(40));
      expect(match.after).toBe('x'.repeat(40));
      expect(match.column).toBe(61);
    });

    it('setQuery_whenTextContainsRegexMetacharacters_matchesThemLiterally', () => {
      const harness: PaneHarness = createPane(['cost is a.b (usd)', 'cost is axb'], 1);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);

      adapter.setQuery(query('a.b'));

      expect(adapter.matches().map((match: FindResultItem): number => match.line)).toEqual([1]);
    });

    it('setQuery_whenCaseSensitiveIsOff_matchesRegardlessOfCase', () => {
      const harness: PaneHarness = createPane(['Alpha', 'alpha'], 2);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);

      adapter.setQuery(query('alpha'));

      expect(adapter.matches().length).toBe(2);
    });

    it('setQuery_whenCaseSensitiveIsOn_matchesOnlyTheExactCase', () => {
      const harness: PaneHarness = createPane(['Alpha', 'alpha'], 1);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);

      adapter.setQuery(query('alpha', { caseSensitive: true }));

      expect(adapter.matches().map((match: FindResultItem): number => match.line)).toEqual([2]);
    });

    it('setQuery_whenWholeWordIsOn_skipsMatchesInsideLargerWords', () => {
      const harness: PaneHarness = createPane(['alphabet', 'alpha'], 1);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);

      adapter.setQuery(query('alpha', { wholeWord: true }));

      expect(adapter.matches().map((match: FindResultItem): number => match.line)).toEqual([2]);
    });

    it('setQuery_whenRegexpIsOn_treatsTheTextAsAPattern', () => {
      const harness: PaneHarness = createPane(['error 404', 'error abc'], 1);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);

      adapter.setQuery(query('\\d+', { regexp: true }));

      expect(adapter.matches().map((match: FindResultItem): string => match.text)).toEqual(['404']);
    });

    it('setQuery_whenThePatternIsInvalid_clearsTheMatchesInsteadOfThrowing', () => {
      const harness: PaneHarness = createPane(['alpha'], 1);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);

      adapter.setQuery(query('(unclosed', { regexp: true }));

      expect(adapter.matches()).toEqual([]);
      expect(harness.calls).toEqual([{ kind: 'clear' }]);
    });

    it('setQuery_whenThePatternMatchesEmptyText_advancesInsteadOfLooping', () => {
      const harness: PaneHarness = createPane(['ab'], 0);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);

      adapter.setQuery(query('x*', { regexp: true }));

      expect(adapter.matches()).toEqual([]);
    });

    it('setQuery_whenThereAreMatches_paintsThemThroughTheAddon', () => {
      const harness: PaneHarness = createPane(['alpha'], 1);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);

      adapter.setQuery(query('alpha', { caseSensitive: true, wholeWord: true }));

      expect(harness.calls.length).toBe(1);
      expect(harness.calls[0].kind).toBe('next');
      expect(harness.calls[0].term).toBe('alpha');
      expect(harness.calls[0].options).toMatchObject({
        regex: false,
        wholeWord: true,
        caseSensitive: true,
      });
      expect(harness.calls[0].options?.decorations).toBeDefined();
    });

    it('setQuery_whenNothingMatches_clearsTheHighlights', () => {
      const harness: PaneHarness = createPane(['alpha'], 0);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);

      adapter.setQuery(query('omega'));

      expect(adapter.matches()).toEqual([]);
      expect(harness.calls).toEqual([{ kind: 'clear' }]);
    });

    it('setQuery_whenTheAddonReportsResults_tracksTheActiveIndex', () => {
      const harness: PaneHarness = createPane(['alpha alpha'], 2);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);

      adapter.setQuery(query('alpha'));

      expect(adapter.activeIndex()).toBe(0);
    });
  });

  describe('navigation', () => {
    it('select_whenTheIndexIsOutOfRange_doesNothing', () => {
      const harness: PaneHarness = createPane(['alpha alpha'], 2);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);
      adapter.setQuery(query('alpha'));
      const before: number = harness.calls.length;

      adapter.select(-1);
      adapter.select(2);

      expect(harness.calls.length).toBe(before);
    });

    it('select_whenThereIsNoQuery_doesNothing', () => {
      const harness: PaneHarness = createPane(['alpha'], 1);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);

      adapter.select(0);

      expect(harness.calls).toEqual([]);
    });

    it('select_whenTheTargetIsAhead_stepsForwardToIt', () => {
      const harness: PaneHarness = createPane(['a a a a'], 4);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);
      adapter.setQuery(query('a'));

      adapter.select(3);

      expect(adapter.activeIndex()).toBe(3);
    });

    it('select_whenTheTargetIsBehind_stepsBackwardToIt', () => {
      const harness: PaneHarness = createPane(['a a a a'], 4);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);
      adapter.setQuery(query('a'));
      adapter.select(3);

      adapter.select(1);

      expect(adapter.activeIndex()).toBe(1);
      expect(harness.calls.some((call: SearchCall): boolean => call.kind === 'previous')).toBe(
        true,
      );
    });

    it('next_whenNotAtTheLastMatch_selectsTheFollowingMatch', () => {
      const harness: PaneHarness = createPane(['a a a'], 3);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);
      adapter.setQuery(query('a'));

      adapter.next();

      expect(adapter.activeIndex()).toBe(1);
    });

    it('next_whenAtTheLastMatch_staysPutRatherThanWrapping', () => {
      const harness: PaneHarness = createPane(['a a'], 2);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);
      adapter.setQuery(query('a'));
      adapter.next();
      const before: number = harness.calls.length;

      adapter.next();

      expect(adapter.activeIndex()).toBe(1);
      expect(harness.calls.length).toBe(before);
    });

    it('previous_whenNotAtTheFirstMatch_selectsThePrecedingMatch', () => {
      const harness: PaneHarness = createPane(['a a a'], 3);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);
      adapter.setQuery(query('a'));
      adapter.select(2);

      adapter.previous();

      expect(adapter.activeIndex()).toBe(1);
    });

    it('previous_whenAtTheFirstMatch_staysPutRatherThanWrapping', () => {
      const harness: PaneHarness = createPane(['a a'], 2);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);
      adapter.setQuery(query('a'));
      const before: number = harness.calls.length;

      adapter.previous();

      expect(adapter.activeIndex()).toBe(0);
      expect(harness.calls.length).toBe(before);
    });
  });

  describe('clear', () => {
    it('clear_resetsTheStateAndUnsubscribesFromTheAddon', () => {
      const harness: PaneHarness = createPane(['alpha alpha'], 2);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);
      adapter.setQuery(query('alpha'));
      expect(harness.subscribed()).toBe(true);

      adapter.clear();

      expect(adapter.matches()).toEqual([]);
      expect(adapter.activeIndex()).toBe(-1);
      expect(harness.subscribed()).toBe(false);
      expect(harness.calls.at(-1)).toEqual({ kind: 'clear' });
    });

    it('clear_whenCalledTwice_isHarmless', () => {
      const harness: PaneHarness = createPane(['alpha'], 1);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);
      adapter.setQuery(query('alpha'));

      adapter.clear();
      adapter.clear();

      expect(adapter.matches()).toEqual([]);
    });

    it('clear_whenAQueryFollows_resubscribesToTheAddon', () => {
      const harness: PaneHarness = createPane(['alpha'], 1);
      const adapter: TerminalFindAdapter = new TerminalFindAdapter(() => harness.pane);
      adapter.setQuery(query('alpha'));
      adapter.clear();

      adapter.setQuery(query('alpha'));

      expect(harness.subscribed()).toBe(true);
      expect(adapter.matches().length).toBe(1);
    });
  });
});
