import { TestBed } from '@angular/core/testing';

import { DocumentStatus, DocumentStatusInfo } from './document-status';

/**
 * Builds a document status for a given language.
 * @param language The language identifier the status reports.
 * @returns Returns the status.
 */
function status(language: string): DocumentStatusInfo {
  return { line: 3, column: 14, language, eol: 'LF', encoding: 'UTF-8' };
}

describe('DocumentStatus', () => {
  let service: DocumentStatus;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DocumentStatus);
  });

  it('info_whenNoDocumentIsPublishing_isNull', () => {
    expect(service.info()).toBeNull();
  });

  it('set_whenADocumentPublishes_exposesItsStatus', () => {
    service.set('doc-1', status('typescript'));

    expect(service.info()).toEqual(status('typescript'));
  });

  it('set_whenAnotherDocumentPublishes_replacesTheStatus', () => {
    service.set('doc-1', status('typescript'));

    service.set('doc-2', status('markdown'));

    expect(service.info()?.language).toBe('markdown');
  });

  it('clear_whenTheOwnerClears_removesTheStatus', () => {
    service.set('doc-1', status('typescript'));

    service.clear('doc-1');

    expect(service.info()).toBeNull();
  });

  it('clear_whenADeactivatingDocumentIsNotTheOwner_leavesTheStatusIntact', () => {
    service.set('doc-1', status('typescript'));
    service.set('doc-2', status('markdown'));

    service.clear('doc-1');

    expect(service.info()?.language).toBe('markdown');
  });
});
