import { describe, expect, it } from 'vitest';
import { history } from '@milkdown/kit/prose/history';
import { Node as ProseNode, Schema } from '@milkdown/kit/prose/model';
import { EditorState, Transaction } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { search } from 'prosemirror-search';
import { FindQuery, FindResultItem } from '@shared/angular/components/find-panel/find-adapter';
import { MarkdownFindAdapter } from './markdown-find-adapter';

/**
 * Holds a minimal paragraph-and-text schema. The adapter only ever reads block text and positions, so
 * the markdown editor's full node set would add nothing the assertions could observe. No `toDOM` is
 * declared because nothing here renders: the view is stubbed and the document is only ever read.
 */
const SCHEMA: Schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    text: { group: 'inline' },
  },
  marks: {},
});

/**
 * Drives a stubbed ProseMirror view over a real editor state and exposes the hooks the tests need: the
 * document's current text and how often the adapter took focus.
 */
interface ViewHarness {
  readonly view: EditorView;
  paragraphs(): readonly string[];
  focused(): number;
}

/**
 * Builds a stubbed editor view over a real {@link EditorState} carrying the search and history plugins.
 * Only the view shell is faked — dispatch genuinely applies transactions — so the adapter drives the
 * real `prosemirror-search` matching and the real history stack rather than a reimplementation of them.
 * @param paragraphs The document's paragraphs.
 * @returns Returns the harness.
 */
function createView(paragraphs: readonly string[]): ViewHarness {
  const doc: ProseNode = SCHEMA.node(
    'doc',
    null,
    paragraphs.map((text: string): ProseNode =>
      SCHEMA.node('paragraph', null, text.length === 0 ? [] : [SCHEMA.text(text)]),
    ),
  );
  let state: EditorState = EditorState.create({
    doc,
    schema: SCHEMA,
    plugins: [search(), history()],
  });
  let focusCount: number = 0;

  const view: EditorView = {
    get state(): EditorState {
      return state;
    },
    dispatch: (transaction: Transaction): void => {
      state = state.apply(transaction);
    },
    focus: (): void => {
      focusCount++;
    },
  } as unknown as EditorView;

  return {
    view,
    paragraphs: (): readonly string[] => {
      const texts: string[] = [];
      state.doc.forEach((node: ProseNode): void => {
        texts.push(node.textContent);
      });
      return texts;
    },
    focused: (): number => focusCount,
  };
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

describe('MarkdownFindAdapter', () => {
  describe('capabilities', () => {
    it('supportsReplace_isTrue_becauseTheDocumentIsEditable', () => {
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => null);

      expect(adapter.supportsReplace).toBe(true);
      expect(adapter.canUndo()).toBe(false);
    });
  });

  describe('setQuery', () => {
    it('setQuery_whenTheViewIsNotReady_clearsTheMatches', () => {
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => null);

      adapter.setQuery(query('alpha'));

      expect(adapter.matches()).toEqual([]);
      expect(adapter.activeIndex()).toBe(-1);
    });

    it('setQuery_whenTextIsEmpty_clearsTheMatches', () => {
      const harness: ViewHarness = createView(['alpha beta']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);

      adapter.setQuery(query(''));

      expect(adapter.matches()).toEqual([]);
    });

    it('setQuery_whenTextMatches_buildsBlockRelativeMatchesWithPreviews', () => {
      const harness: ViewHarness = createView(['alpha beta', 'gamma beta delta']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);

      adapter.setQuery(query('beta'));

      expect(adapter.matches()).toEqual([
        { line: 1, column: 7, before: 'alpha ', text: 'beta', after: '' },
        { line: 2, column: 7, before: 'gamma ', text: 'beta', after: ' delta' },
      ]);
    });

    it('setQuery_whenABlockIsLong_trimsThePreviewToFortyCharactersPerSide', () => {
      const filler: string = 'x'.repeat(60);
      const harness: ViewHarness = createView([`${filler}needle${filler}`]);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);

      adapter.setQuery(query('needle'));

      const [match]: readonly FindResultItem[] = adapter.matches();
      expect(match.before).toBe('x'.repeat(40));
      expect(match.after).toBe('x'.repeat(40));
      expect(match.column).toBe(61);
    });

    it('setQuery_whenCaseSensitiveIsOff_matchesRegardlessOfCase', () => {
      const harness: ViewHarness = createView(['Alpha', 'alpha']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);

      adapter.setQuery(query('alpha'));

      expect(adapter.matches().length).toBe(2);
    });

    it('setQuery_whenCaseSensitiveIsOn_matchesOnlyTheExactCase', () => {
      const harness: ViewHarness = createView(['Alpha', 'alpha']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);

      adapter.setQuery(query('alpha', { caseSensitive: true }));

      expect(adapter.matches().map((match: FindResultItem): number => match.line)).toEqual([2]);
    });

    it('setQuery_whenWholeWordIsOn_skipsMatchesInsideLargerWords', () => {
      const harness: ViewHarness = createView(['alphabet', 'alpha']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);

      adapter.setQuery(query('alpha', { wholeWord: true }));

      expect(adapter.matches().map((match: FindResultItem): number => match.line)).toEqual([2]);
    });

    it('setQuery_whenRegexpIsOn_treatsTheTextAsAPattern', () => {
      const harness: ViewHarness = createView(['error 404', 'error abc']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);

      adapter.setQuery(query('\\d+', { regexp: true }));

      expect(adapter.matches().map((match: FindResultItem): string => match.text)).toEqual(['404']);
    });

    it('setQuery_whenThePatternIsInvalid_clearsTheMatches', () => {
      const harness: ViewHarness = createView(['alpha']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);

      adapter.setQuery(query('(unclosed', { regexp: true }));

      expect(adapter.matches()).toEqual([]);
      expect(adapter.activeIndex()).toBe(-1);
    });

    it('setQuery_whenNothingMatches_leavesTheListEmpty', () => {
      const harness: ViewHarness = createView(['alpha']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);

      adapter.setQuery(query('omega'));

      expect(adapter.matches()).toEqual([]);
    });
  });

  describe('navigation', () => {
    it('select_whenTheIndexIsInRange_selectsRevealsAndFocusesTheMatch', () => {
      const harness: ViewHarness = createView(['alpha beta']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);
      adapter.setQuery(query('beta'));

      adapter.select(0);

      expect(adapter.activeIndex()).toBe(0);
      expect(
        harness.view.state.doc.textBetween(
          harness.view.state.selection.from,
          harness.view.state.selection.to,
        ),
      ).toBe('beta');
      expect(harness.focused()).toBe(1);
    });

    it('select_whenTheIndexIsOutOfRange_doesNothing', () => {
      const harness: ViewHarness = createView(['alpha']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);
      adapter.setQuery(query('alpha'));

      adapter.select(-1);
      adapter.select(1);

      expect(adapter.activeIndex()).toBe(-1);
      expect(harness.focused()).toBe(0);
    });

    it('select_whenTheViewIsNotReady_doesNothing', () => {
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => null);

      adapter.select(0);

      expect(adapter.activeIndex()).toBe(-1);
    });

    it('next_whenNotAtTheLastMatch_selectsTheFollowingMatch', () => {
      const harness: ViewHarness = createView(['a a a']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);
      adapter.setQuery(query('a'));

      adapter.next();
      adapter.next();

      expect(adapter.activeIndex()).toBe(1);
    });

    it('next_whenAtTheLastMatch_staysPutRatherThanWrapping', () => {
      const harness: ViewHarness = createView(['a a']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);
      adapter.setQuery(query('a'));
      adapter.select(1);

      adapter.next();

      expect(adapter.activeIndex()).toBe(1);
    });

    it('next_whenThereAreNoMatches_doesNothing', () => {
      const harness: ViewHarness = createView(['alpha']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);
      adapter.setQuery(query('omega'));

      adapter.next();

      expect(adapter.activeIndex()).toBe(-1);
    });

    it('previous_whenNotAtTheFirstMatch_selectsThePrecedingMatch', () => {
      const harness: ViewHarness = createView(['a a a']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);
      adapter.setQuery(query('a'));
      adapter.select(2);

      adapter.previous();

      expect(adapter.activeIndex()).toBe(1);
    });

    it('previous_whenAtTheFirstMatch_staysPutRatherThanWrapping', () => {
      const harness: ViewHarness = createView(['a a']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);
      adapter.setQuery(query('a'));
      adapter.select(0);

      adapter.previous();

      expect(adapter.activeIndex()).toBe(0);
    });
  });

  describe('replace', () => {
    it('replace_whenAMatchIsActive_rewritesItAndDropsItFromTheList', () => {
      const harness: ViewHarness = createView(['alpha beta alpha']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);
      adapter.setQuery(query('alpha'));
      adapter.select(0);

      adapter.replace('omega');

      expect(harness.paragraphs()).toEqual(['omega beta alpha']);
      expect(adapter.matches().length).toBe(1);
      expect(adapter.canUndo()).toBe(true);
    });

    it('replace_whenNoMatchIsActive_doesNothing', () => {
      const harness: ViewHarness = createView(['alpha']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);
      adapter.setQuery(query('alpha'));

      adapter.replace('omega');

      expect(harness.paragraphs()).toEqual(['alpha']);
      expect(adapter.canUndo()).toBe(false);
    });

    it('replace_whenThereIsNoQuery_doesNothing', () => {
      const harness: ViewHarness = createView(['alpha']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);

      adapter.replace('omega');

      expect(harness.paragraphs()).toEqual(['alpha']);
      expect(adapter.canUndo()).toBe(false);
    });

    it('replaceAll_rewritesEveryMatchAcrossBlocks', () => {
      const harness: ViewHarness = createView(['alpha beta alpha', 'alpha']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);
      adapter.setQuery(query('alpha'));

      adapter.replaceAll('omega');

      expect(harness.paragraphs()).toEqual(['omega beta omega', 'omega']);
      expect(adapter.matches()).toEqual([]);
      expect(adapter.canUndo()).toBe(true);
    });

    it('replaceAll_whenThereIsNoQuery_doesNothing', () => {
      const harness: ViewHarness = createView(['alpha']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);

      adapter.replaceAll('omega');

      expect(harness.paragraphs()).toEqual(['alpha']);
      expect(adapter.canUndo()).toBe(false);
    });

    it('replaceAll_whenTheViewIsNotReady_doesNothing', () => {
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => null);
      adapter.setQuery(query('alpha'));

      adapter.replaceAll('omega');

      expect(adapter.canUndo()).toBe(false);
    });
  });

  describe('undo', () => {
    it('undo_afterAReplace_restoresTheTextAndTheMatch', () => {
      const harness: ViewHarness = createView(['alpha beta']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);
      adapter.setQuery(query('alpha'));
      adapter.select(0);
      adapter.replace('omega');

      adapter.undo();

      expect(harness.paragraphs()).toEqual(['alpha beta']);
      expect(adapter.matches().length).toBe(1);
      expect(adapter.canUndo()).toBe(false);
    });

    it('undo_whenTheViewIsNotReady_doesNothing', () => {
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => null);

      adapter.undo();

      expect(adapter.canUndo()).toBe(false);
    });
  });

  describe('clear', () => {
    it('clear_resetsTheStateAndDropsTheSearchQuery', () => {
      const harness: ViewHarness = createView(['alpha alpha']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);
      adapter.setQuery(query('alpha'));
      adapter.select(0);

      adapter.clear();

      expect(adapter.matches()).toEqual([]);
      expect(adapter.activeIndex()).toBe(-1);
      expect(adapter.canUndo()).toBe(false);
    });

    it('clear_whenTheViewIsNotReady_stillResetsTheState', () => {
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => null);

      adapter.clear();

      expect(adapter.matches()).toEqual([]);
      expect(adapter.activeIndex()).toBe(-1);
    });

    it('clear_whenAQueryFollows_findsMatchesAgain', () => {
      const harness: ViewHarness = createView(['alpha']);
      const adapter: MarkdownFindAdapter = new MarkdownFindAdapter(() => harness.view);
      adapter.setQuery(query('alpha'));
      adapter.clear();

      adapter.setQuery(query('alpha'));

      expect(adapter.matches().length).toBe(1);
    });
  });
});
