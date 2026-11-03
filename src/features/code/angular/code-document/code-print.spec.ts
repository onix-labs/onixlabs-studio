import { renderCodePrint, tokenClass } from './code-print';

describe('tokenClass', () => {
  it('tokenClass_mapsTokenTypesToThePrintPalette', () => {
    expect(tokenClass('keyword.ts')).toBe('code-print__token--keyword');
    expect(tokenClass('comment.doc.ts')).toBe('code-print__token--comment');
    expect(tokenClass('string.escape.ts')).toBe('code-print__token--string');
    expect(tokenClass('attribute.value.html')).toBe('code-print__token--string');
    expect(tokenClass('attribute.name.html')).toBe('code-print__token--attribute');
    expect(tokenClass('type.identifier.ts')).toBe('code-print__token--type');
  });

  it('tokenClass_leavesIdentifiersAndDelimitersInTheTextColour', () => {
    expect(tokenClass('identifier.ts')).toBeNull();
    expect(tokenClass('delimiter.bracket.ts')).toBeNull();
    expect(tokenClass('')).toBeNull();
  });

  it('tokenClass_matchesWholeSegmentsOnly', () => {
    // `keyed` is not a `key`, nor `typeface` a `type`.
    expect(tokenClass('keyed.ts')).toBeNull();
    expect(tokenClass('typeface')).toBeNull();
  });
});

describe('renderCodePrint', () => {
  let target: HTMLPreElement;

  beforeEach(() => {
    target = document.createElement('pre');
  });

  it('renderCodePrint_withoutColoursOrNumbers_printsTheTextAsIs', () => {
    renderCodePrint(target, 'one\ntwo\r\nthree', { tokens: null, lineNumbers: false });

    expect(target.textContent).toBe('one\ntwo\nthree');
    expect(target.querySelector('span')).toBeNull();
  });

  it('renderCodePrint_withTokens_coloursEachTokenTheirKind', () => {
    renderCodePrint(target, 'const x = "a";', {
      tokens: [
        [
          { offset: 0, type: 'keyword.ts' },
          { offset: 5, type: '' },
          { offset: 6, type: 'identifier.ts' },
          { offset: 7, type: '' },
          { offset: 10, type: 'string.ts' },
          { offset: 13, type: 'delimiter.ts' },
        ],
      ],
      lineNumbers: false,
    });

    expect(target.textContent).toBe('const x = "a";');
    const spans: HTMLSpanElement[] = Array.from(target.querySelectorAll('span'));
    expect(spans.map((span: HTMLSpanElement): string => span.className)).toEqual([
      'code-print__token--keyword',
      'code-print__token--string',
    ]);
    expect(spans.map((span: HTMLSpanElement): string => span.textContent ?? '')).toEqual([
      'const',
      '"a"',
    ]);
  });

  it('renderCodePrint_withLineNumbers_numbersEveryLine', () => {
    renderCodePrint(target, 'a\n\nc', { tokens: null, lineNumbers: true });

    const numbers: string[] = Array.from(target.querySelectorAll('.code-print__number')).map(
      (element: Element): string => element.textContent ?? '',
    );
    expect(numbers).toEqual(['1', '2', '3']);
    expect(target.classList.contains('code-print--numbered')).toBe(true);
    expect(target.style.getPropertyValue('--code-print-gutter')).toBe('1');
  });

  it('renderCodePrint_neverParsesTheTextAsMarkup', () => {
    renderCodePrint(target, '<img src=x onerror=alert(1)>', {
      tokens: [[{ offset: 0, type: 'tag.html' }]],
      lineNumbers: false,
    });

    expect(target.querySelector('img')).toBeNull();
    expect(target.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('renderCodePrint_replacesWhatTheMirrorHeld', () => {
    renderCodePrint(target, 'first', { tokens: null, lineNumbers: true });
    renderCodePrint(target, 'second', { tokens: null, lineNumbers: false });

    expect(target.textContent).toBe('second');
    expect(target.classList.contains('code-print--numbered')).toBe(false);
  });
});
