import { TestBed } from '@angular/core/testing';
import type { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import { CodeStatus } from './code-status';
import { CodeStatusStrip } from './code-status-strip';

describe('CodeStatusStrip', () => {
  /**
   * Reads the trailing segments the strip shows.
   * @returns Returns them.
   */
  function trailing(): readonly StatusSegment[] {
    const strip: CodeStatusStrip = TestBed.createComponent(CodeStatusStrip).componentInstance;
    return (strip as unknown as { trailing(): readonly StatusSegment[] }).trailing();
  }

  it('eolAndEncoding_areMenus_whenTheDocumentCanChangeThem', () => {
    const did: string[] = [];
    TestBed.inject(CodeStatus).publish({
      path: '/ws/a.ts',
      line: 1,
      column: 1,
      eol: 'LF',
      encoding: 'UTF-8',
      actions: {
        saveWithEncoding: (encoding: string): void => void did.push(`save ${encoding}`),
        setEol: (eol: 'LF' | 'CRLF'): void => void did.push(`eol ${eol}`),
      },
    });

    const [, , eol, encoding] = trailing();
    eol.menu?.choose('CRLF');
    encoding.menu?.choose('save:iso88591');

    expect(encoding.menu?.items.map((item) => item.label)).toEqual(['Save with Encoding']);
    expect(did).toEqual(['eol CRLF', 'save iso88591']);
  });

  it('eolAndEncoding_onlyShowTheirValue_withoutActions', () => {
    TestBed.inject(CodeStatus).publish({
      path: null,
      line: 1,
      column: 1,
      eol: 'CRLF',
      encoding: 'UTF-16 LE',
    });

    const [, , eol, encoding] = trailing();
    expect(eol).toEqual({ id: 'code-eol', text: 'CRLF' });
    expect(encoding).toEqual({ id: 'code-encoding', text: 'UTF-16 LE' });
  });
});
