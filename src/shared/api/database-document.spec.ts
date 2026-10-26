import { describe, expect, it } from 'vitest';
import {
  DATABASE_DOCUMENT_KIND,
  DATABASE_DOCUMENT_VERSION,
  DatabaseDocument,
  isDatabaseDocumentName,
  parseDatabaseDocument,
} from './database-document';

describe('parseDatabaseDocument', (): void => {
  const valid: DatabaseDocument = {
    kind: DATABASE_DOCUMENT_KIND,
    version: DATABASE_DOCUMENT_VERSION,
    connections: [{ id: 'c1', name: 'Local', engine: 'sqlite', values: { file: '/tmp/a.db' } }],
    queries: [{ id: 'q1', title: 'Query 1', connectionId: 'c1', text: 'select 1;' }],
  };

  it('readsADocumentThisBuildWrote', (): void => {
    expect(parseDatabaseDocument(JSON.stringify(valid))).toEqual(valid);
  });

  it('refusesMalformedJson', (): void => {
    expect(parseDatabaseDocument('{ not json')).toBeNull();
  });

  it('refusesAForeignMoniker', (): void => {
    expect(parseDatabaseDocument(JSON.stringify({ ...valid, kind: 'someone.else' }))).toBeNull();
  });

  it('refusesANewerVersion', (): void => {
    // Half-loading a newer document and saving it back would drop whatever the newer build added.
    expect(
      parseDatabaseDocument(JSON.stringify({ ...valid, version: DATABASE_DOCUMENT_VERSION + 1 })),
    ).toBeNull();
  });

  it('refusesADocumentMissingItsCollections', (): void => {
    expect(
      parseDatabaseDocument(
        JSON.stringify({ kind: DATABASE_DOCUMENT_KIND, version: 1, connections: [] }),
      ),
    ).toBeNull();
  });
});

describe('isDatabaseDocumentName', (): void => {
  it('matchesTheSuffixWhateverItsCase', (): void => {
    expect(isDatabaseDocumentName('prod.database.json')).toBe(true);
    expect(isDatabaseDocumentName('Prod.DATABASE.JSON')).toBe(true);
    expect(isDatabaseDocumentName('prod.json')).toBe(false);
    expect(isDatabaseDocumentName('orders.api.json')).toBe(false);
  });
});
