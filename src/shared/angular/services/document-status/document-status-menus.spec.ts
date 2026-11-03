import type { MenuItem } from '@shared/angular/components/menu/menu';
import type { TextEncoding } from '@shared/api/text-encodings';
import type { DocumentStatusActions } from './document-status';
import {
  chooseEncoding,
  chooseEol,
  encodingMenuItems,
  eolMenuItems,
} from './document-status-menus';

describe('document status menus', () => {
  it('eolMenu_offersLfAndCrlf_markingTheDocumentsOwn', () => {
    expect(
      eolMenuItems('CRLF').map((item: MenuItem): [string, boolean | undefined] => [
        item.id,
        item.active,
      ]),
    ).toEqual([
      ['LF', false],
      ['CRLF', true],
    ]);
  });

  it('chooseEol_convertsTheLineEndings', () => {
    const chosen: string[] = [];
    const setEol: (eol: 'LF' | 'CRLF') => void = (eol: 'LF' | 'CRLF'): void =>
      void chosen.push(eol);

    chooseEol('CRLF', { setEol });
    chooseEol('nonsense', { setEol });

    expect(chosen).toEqual(['CRLF']);
  });

  it('encodingMenu_offersOnlyWhatTheDocumentCanDo', () => {
    const both: readonly MenuItem[] = encodingMenuItems({
      reopenWithEncoding: (): void => undefined,
      saveWithEncoding: (): void => undefined,
    });
    expect(both.map((item: MenuItem): string => item.label)).toEqual([
      'Reopen with Encoding',
      'Save with Encoding',
    ]);
    expect(both[0].children?.map((item: MenuItem): string => item.label)).toEqual([
      'UTF-8',
      'UTF-16 LE',
      'UTF-16 BE',
      'Windows 1252',
      'ISO 8859-1',
    ]);
    // No file yet: nothing to reopen, only save.
    expect(
      encodingMenuItems({ saveWithEncoding: (): void => undefined }).map(
        (item: MenuItem): string => item.id,
      ),
    ).toEqual(['save']);
    expect(encodingMenuItems(undefined)).toEqual([]);
    // No row in either menu carries an ellipsis.
    expect(JSON.stringify(both)).not.toContain('…');
  });

  it('chooseEncoding_reopensOrSavesInTheChosenEncoding', () => {
    const reopened: TextEncoding[] = [];
    const saved: TextEncoding[] = [];
    const actions: DocumentStatusActions = {
      reopenWithEncoding: (encoding: TextEncoding): void => void reopened.push(encoding),
      saveWithEncoding: (encoding: TextEncoding): void => void saved.push(encoding),
    };

    chooseEncoding('reopen:iso88591', actions);
    chooseEncoding('save:utf16be', actions);
    chooseEncoding('save:klingon', actions);

    expect(reopened).toEqual(['iso88591']);
    expect(saved).toEqual(['utf16be']);
  });
});
