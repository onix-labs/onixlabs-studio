import type * as MonacoApi from 'monaco-editor';
import { describe, expect, it } from 'vitest';
import { FindQuery, FindResultItem } from '@shared/angular/components/find-panel/find-adapter';
import { CodeFindAdapter } from './code-find-adapter';

/**
 * Drives a stubbed Monaco editor over an in-memory buffer and exposes the hooks the tests need: the
 * buffer's current text, the ranges the adapter highlighted, and the selection it last revealed.
 */
interface EditorHarness {
  readonly editor: MonacoApi.editor.IStandaloneCodeEditor;
  text(): string;
  decorations(): readonly MonacoApi.IRange[];
  selection(): MonacoApi.IRange | null;
  revealed(): number;
}

/**
 * Builds a stubbed editor backed by a real in-memory buffer: `findMatches` genuinely scans the text and
 * `executeEdits` genuinely rewrites it (with an undo stack behind the editor's `undo` trigger), so a
 * replace really does drop the match it consumed and an undo really does bring it back.
 * @param initial The buffer's initial lines.
 * @returns Returns the harness.
 */
function createEditor(initial: readonly string[]): EditorHarness {
  let lines: string[] = [...initial];
  const history: string[][] = [];
  let painted: readonly MonacoApi.IRange[] = [];
  let selected: MonacoApi.IRange | null = null;
  let revealCount: number = 0;

  const collection: MonacoApi.editor.IEditorDecorationsCollection = {
    set: (decorations: MonacoApi.editor.IModelDeltaDecoration[]): void => {
      painted = decorations.map(
        (decoration: MonacoApi.editor.IModelDeltaDecoration): MonacoApi.IRange => decoration.range,
      );
    },
    clear: (): void => {
      painted = [];
    },
  } as unknown as MonacoApi.editor.IEditorDecorationsCollection;

  const model: MonacoApi.editor.ITextModel = {
    getLineContent: (lineNumber: number): string => lines[lineNumber - 1],
    getValueInRange: (range: MonacoApi.IRange): string =>
      lines[range.startLineNumber - 1].slice(range.startColumn - 1, range.endColumn - 1),
    findMatches: (
      searchString: string,
      _searchOnlyEditableRange: boolean,
      isRegex: boolean,
      matchCase: boolean,
      wordSeparators: string | null,
    ): MonacoApi.editor.FindMatch[] => {
      const body: string = isRegex
        ? searchString
        : searchString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const source: string = wordSeparators !== null ? `\\b(?:${body})\\b` : body;
      const regex: RegExp = new RegExp(source, `g${matchCase ? '' : 'i'}`);
      const found: MonacoApi.editor.FindMatch[] = [];
      lines.forEach((lineText: string, index: number): void => {
        regex.lastIndex = 0;
        let match: RegExpExecArray | null = regex.exec(lineText);
        while (match !== null) {
          if (match[0].length === 0) {
            regex.lastIndex = match.index + 1;
            match = regex.exec(lineText);
            continue;
          }
          found.push({
            range: {
              startLineNumber: index + 1,
              startColumn: match.index + 1,
              endLineNumber: index + 1,
              endColumn: match.index + 1 + match[0].length,
            },
          } as MonacoApi.editor.FindMatch);
          match = regex.exec(lineText);
        }
      });
      return found;
    },
  } as unknown as MonacoApi.editor.ITextModel;

  const editor: MonacoApi.editor.IStandaloneCodeEditor = {
    getModel: (): MonacoApi.editor.ITextModel => model,
    createDecorationsCollection: (): MonacoApi.editor.IEditorDecorationsCollection => collection,
    setSelection: (range: MonacoApi.IRange): void => {
      selected = range;
    },
    revealRangeInCenterIfOutsideViewport: (): void => {
      revealCount++;
    },
    executeEdits: (
      _source: string,
      edits: MonacoApi.editor.IIdentifiedSingleEditOperation[],
    ): boolean => {
      history.push([...lines]);
      // Apply bottom-up so an earlier edit never shifts the columns of a later one.
      const ordered: MonacoApi.editor.IIdentifiedSingleEditOperation[] = [...edits].sort(
        (
          left: MonacoApi.editor.IIdentifiedSingleEditOperation,
          right: MonacoApi.editor.IIdentifiedSingleEditOperation,
        ): number =>
          right.range.startLineNumber - left.range.startLineNumber ||
          right.range.startColumn - left.range.startColumn,
      );
      ordered.forEach((edit: MonacoApi.editor.IIdentifiedSingleEditOperation): void => {
        const index: number = edit.range.startLineNumber - 1;
        const lineText: string = lines[index];
        lines[index] =
          lineText.slice(0, edit.range.startColumn - 1) +
          (edit.text ?? '') +
          lineText.slice(edit.range.endColumn - 1);
      });
      return true;
    },
    trigger: (_source: string | null | undefined, handlerId: string): void => {
      if (handlerId === 'undo') {
        lines = history.pop() ?? lines;
      }
    },
  } as unknown as MonacoApi.editor.IStandaloneCodeEditor;

  return {
    editor,
    text: (): string => lines.join('\n'),
    decorations: (): readonly MonacoApi.IRange[] => painted,
    selection: (): MonacoApi.IRange | null => selected,
    revealed: (): number => revealCount,
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

describe('CodeFindAdapter', () => {
  describe('capabilities', () => {
    it('supportsReplace_isTrue_becauseAModelIsEditable', () => {
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => null);

      expect(adapter.supportsReplace).toBe(true);
      expect(adapter.canUndo()).toBe(false);
    });
  });

  describe('setQuery', () => {
    it('setQuery_whenTheEditorIsNotReady_clearsTheMatches', () => {
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => null);

      adapter.setQuery(query('alpha'));

      expect(adapter.matches()).toEqual([]);
      expect(adapter.activeIndex()).toBe(-1);
    });

    it('setQuery_whenTextIsEmpty_clearsTheMatches', () => {
      const harness: EditorHarness = createEditor(['alpha beta']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);

      adapter.setQuery(query(''));

      expect(adapter.matches()).toEqual([]);
    });

    it('setQuery_whenTextMatches_buildsOneBasedMatchesWithPreviews', () => {
      const harness: EditorHarness = createEditor(['alpha beta', 'gamma beta delta']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);

      adapter.setQuery(query('beta'));

      expect(adapter.matches()).toEqual([
        { line: 1, column: 7, before: 'alpha ', text: 'beta', after: '' },
        { line: 2, column: 7, before: 'gamma ', text: 'beta', after: ' delta' },
      ]);
    });

    it('setQuery_whenALineIsLong_trimsThePreviewToFortyCharactersPerSide', () => {
      const filler: string = 'x'.repeat(60);
      const harness: EditorHarness = createEditor([`${filler}needle${filler}`]);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);

      adapter.setQuery(query('needle'));

      const [match]: readonly FindResultItem[] = adapter.matches();
      expect(match.before).toBe('x'.repeat(40));
      expect(match.after).toBe('x'.repeat(40));
    });

    it('setQuery_whenThereAreMatches_highlightsEveryOne', () => {
      const harness: EditorHarness = createEditor(['a a a']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);

      adapter.setQuery(query('a'));

      expect(harness.decorations().length).toBe(3);
    });

    it('setQuery_whenWholeWordIsOn_constrainsToWordBoundaries', () => {
      const harness: EditorHarness = createEditor(['alphabet', 'alpha']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);

      adapter.setQuery(query('alpha', { wholeWord: true }));

      expect(adapter.matches().map((match: FindResultItem): number => match.line)).toEqual([2]);
    });

    it('setQuery_whenCaseSensitiveIsOn_matchesOnlyTheExactCase', () => {
      const harness: EditorHarness = createEditor(['Alpha', 'alpha']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);

      adapter.setQuery(query('alpha', { caseSensitive: true }));

      expect(adapter.matches().map((match: FindResultItem): number => match.line)).toEqual([2]);
    });

    it('setQuery_whenRegexpIsOn_treatsTheTextAsAPattern', () => {
      const harness: EditorHarness = createEditor(['error 404', 'error abc']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);

      adapter.setQuery(query('\\d+', { regexp: true }));

      expect(adapter.matches().map((match: FindResultItem): string => match.text)).toEqual(['404']);
    });

    it('setQuery_whenReissued_resetsTheUndoDepth', () => {
      const harness: EditorHarness = createEditor(['alpha']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);
      adapter.setQuery(query('alpha'));
      adapter.select(0);
      adapter.replace('omega');
      expect(adapter.canUndo()).toBe(true);

      adapter.setQuery(query('omega'));

      expect(adapter.canUndo()).toBe(false);
    });
  });

  describe('navigation', () => {
    it('select_whenTheIndexIsInRange_selectsAndRevealsTheMatch', () => {
      const harness: EditorHarness = createEditor(['alpha beta']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);
      adapter.setQuery(query('beta'));

      adapter.select(0);

      expect(adapter.activeIndex()).toBe(0);
      expect(harness.selection()).toMatchObject({ startLineNumber: 1, startColumn: 7 });
      expect(harness.revealed()).toBe(1);
    });

    it('select_whenTheIndexIsOutOfRange_doesNothing', () => {
      const harness: EditorHarness = createEditor(['alpha']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);
      adapter.setQuery(query('alpha'));

      adapter.select(-1);
      adapter.select(1);

      expect(adapter.activeIndex()).toBe(-1);
      expect(harness.selection()).toBeNull();
    });

    it('next_whenNotAtTheLastMatch_selectsTheFollowingMatch', () => {
      const harness: EditorHarness = createEditor(['a a a']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);
      adapter.setQuery(query('a'));

      adapter.next();
      adapter.next();

      expect(adapter.activeIndex()).toBe(1);
    });

    it('next_whenAtTheLastMatch_staysPutRatherThanWrapping', () => {
      const harness: EditorHarness = createEditor(['a a']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);
      adapter.setQuery(query('a'));
      adapter.select(1);

      adapter.next();

      expect(adapter.activeIndex()).toBe(1);
    });

    it('next_whenThereAreNoMatches_doesNothing', () => {
      const harness: EditorHarness = createEditor(['alpha']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);
      adapter.setQuery(query('omega'));

      adapter.next();

      expect(adapter.activeIndex()).toBe(-1);
    });

    it('previous_whenNotAtTheFirstMatch_selectsThePrecedingMatch', () => {
      const harness: EditorHarness = createEditor(['a a a']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);
      adapter.setQuery(query('a'));
      adapter.select(2);

      adapter.previous();

      expect(adapter.activeIndex()).toBe(1);
    });

    it('previous_whenAtTheFirstMatch_staysPutRatherThanWrapping', () => {
      const harness: EditorHarness = createEditor(['a a']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);
      adapter.setQuery(query('a'));
      adapter.select(0);

      adapter.previous();

      expect(adapter.activeIndex()).toBe(0);
    });
  });

  describe('replace', () => {
    it('replace_whenAMatchIsActive_rewritesItAndDropsItFromTheList', () => {
      const harness: EditorHarness = createEditor(['alpha beta alpha']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);
      adapter.setQuery(query('alpha'));
      adapter.select(0);

      adapter.replace('omega');

      expect(harness.text()).toBe('omega beta alpha');
      expect(adapter.matches().length).toBe(1);
      expect(adapter.canUndo()).toBe(true);
    });

    it('replace_whenTheLastMatchGoes_clampsTheSelectionToWhatRemains', () => {
      const harness: EditorHarness = createEditor(['alpha alpha']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);
      adapter.setQuery(query('alpha'));
      adapter.select(1);

      adapter.replace('omega');

      expect(adapter.matches().length).toBe(1);
      expect(adapter.activeIndex()).toBe(0);
    });

    it('replace_whenTheOnlyMatchGoes_leavesNothingActive', () => {
      const harness: EditorHarness = createEditor(['alpha']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);
      adapter.setQuery(query('alpha'));
      adapter.select(0);

      adapter.replace('omega');

      expect(adapter.matches()).toEqual([]);
      expect(adapter.activeIndex()).toBe(-1);
    });

    it('replace_whenNoMatchIsActive_doesNothing', () => {
      const harness: EditorHarness = createEditor(['alpha']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);
      adapter.setQuery(query('alpha'));

      adapter.replace('omega');

      expect(harness.text()).toBe('alpha');
      expect(adapter.canUndo()).toBe(false);
    });

    it('replace_whenTheEditorIsNotReady_doesNothing', () => {
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => null);

      adapter.replace('omega');

      expect(adapter.canUndo()).toBe(false);
    });

    it('replaceAll_rewritesEveryMatchInOneEdit', () => {
      const harness: EditorHarness = createEditor(['alpha beta alpha', 'alpha']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);
      adapter.setQuery(query('alpha'));

      adapter.replaceAll('omega');

      expect(harness.text()).toBe('omega beta omega\nomega');
      expect(adapter.matches()).toEqual([]);
      expect(adapter.activeIndex()).toBe(-1);
      expect(adapter.canUndo()).toBe(true);
    });

    it('replaceAll_whenThereAreNoMatches_doesNothing', () => {
      const harness: EditorHarness = createEditor(['alpha']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);
      adapter.setQuery(query('omega'));

      adapter.replaceAll('kappa');

      expect(harness.text()).toBe('alpha');
      expect(adapter.canUndo()).toBe(false);
    });
  });

  describe('undo', () => {
    it('undo_afterAReplace_restoresTheTextAndTheMatch', () => {
      const harness: EditorHarness = createEditor(['alpha beta']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);
      adapter.setQuery(query('alpha'));
      adapter.select(0);
      adapter.replace('omega');

      adapter.undo();

      expect(harness.text()).toBe('alpha beta');
      expect(adapter.matches().length).toBe(1);
      expect(adapter.canUndo()).toBe(false);
    });

    it('undo_whenThereIsNothingToUndo_doesNothing', () => {
      const harness: EditorHarness = createEditor(['alpha']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);
      adapter.setQuery(query('alpha'));

      adapter.undo();

      expect(harness.text()).toBe('alpha');
      expect(adapter.canUndo()).toBe(false);
    });

    it('undo_whenTheEditorIsNotReady_leavesTheDepthIntact', () => {
      const harness: EditorHarness = createEditor(['alpha']);
      let editor: MonacoApi.editor.IStandaloneCodeEditor | null = harness.editor;
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => editor);
      adapter.setQuery(query('alpha'));
      adapter.select(0);
      adapter.replace('omega');
      editor = null;

      adapter.undo();

      expect(adapter.canUndo()).toBe(true);
    });
  });

  describe('clear', () => {
    it('clear_resetsTheStateAndRemovesTheHighlights', () => {
      const harness: EditorHarness = createEditor(['alpha alpha']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);
      adapter.setQuery(query('alpha'));
      adapter.select(0);

      adapter.clear();

      expect(adapter.matches()).toEqual([]);
      expect(adapter.activeIndex()).toBe(-1);
      expect(adapter.canUndo()).toBe(false);
      expect(harness.decorations()).toEqual([]);
    });

    it('clear_whenNavigationFollows_hasNoRangesToSelect', () => {
      const harness: EditorHarness = createEditor(['alpha']);
      const adapter: CodeFindAdapter = new CodeFindAdapter(() => harness.editor);
      adapter.setQuery(query('alpha'));
      adapter.clear();

      adapter.next();

      expect(adapter.activeIndex()).toBe(-1);
    });
  });
});
