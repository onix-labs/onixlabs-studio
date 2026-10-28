import { describe, expect, it } from 'vitest';
import { LspOpenDocuments } from './lsp-open-documents';

describe('LspOpenDocuments (#1190)', () => {
  const URI: string = 'file:///root/Tests/PersonTests.cs';

  it('aDocumentOpenedAgain_byAWindowThatReloaded_isOneTheServerHasOpen', () => {
    const documents: LspOpenDocuments<string> = new LspOpenDocuments<string>();

    expect(documents.open(URI, 'window')).toBe(false);
    expect(documents.open(URI, 'window')).toBe(true);
  });

  it('aDocumentClosedByOneWindow_staysOpenWhileAnotherHoldsIt', () => {
    const documents: LspOpenDocuments<string> = new LspOpenDocuments<string>();
    documents.open(URI, 'main');
    expect(documents.open(URI, 'pop-out')).toBe(true);

    expect(documents.close(URI, 'pop-out')).toBe(false);
    expect(documents.close(URI, 'main')).toBe(true);
    expect(documents.close(URI, 'main')).toBe(true);
    expect(documents.open(URI, 'main')).toBe(false);
  });

  it('aWindowThatGoesAway_releasesTheDocumentsOnlyItHeld', () => {
    const documents: LspOpenDocuments<string> = new LspOpenDocuments<string>();
    documents.open(URI, 'main');
    documents.open(URI, 'pop-out');
    documents.open('file:///root/A.cs', 'pop-out');

    expect(documents.release('pop-out')).toEqual(['file:///root/A.cs']);
    expect(documents.release('pop-out')).toEqual([]);
    expect(documents.release('main')).toEqual([URI]);
  });
});
