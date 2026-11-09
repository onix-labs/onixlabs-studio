import { describe, expect, it } from 'vitest';
import {
  DATABASE_DOCUMENT_KIND,
  DATABASE_DOCUMENT_VERSION,
  DatabaseDocument,
  DatabaseConnection,
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

  it('writesVersionTwo', (): void => {
    expect(DATABASE_DOCUMENT_VERSION).toBe(2);
  });

  it('readsVersionTwoSealedSecretsAndThePassphraseLock', (): void => {
    const sealed: DatabaseDocument = {
      ...valid,
      connections: [
        { ...valid.connections[0], secrets: { scheme: 'passphrase', data: 'c2VhbGVk' } },
        {
          id: 'c2',
          name: 'Prod',
          engine: 'postgres',
          values: { host: 'h' },
          secrets: { scheme: 'machine', data: 'bWFjaGluZQ==' },
        },
      ],
      passphrase: { salt: 'c2FsdA==', check: 'Y2hlY2s=' },
    };

    expect(parseDatabaseDocument(JSON.stringify(sealed))).toEqual(sealed);
  });

  it('dropsAMalformedSeal', (): void => {
    // A seal that is not well formed can never open, so it is not carried.
    const malformed: unknown[] = [
      'plaintext',
      null,
      { scheme: 'rot13', data: 'x' },
      { scheme: 'machine' },
      { scheme: 'machine', data: 42 },
    ];
    const text: string = JSON.stringify({
      ...valid,
      connections: malformed.map((secrets: unknown, index: number): Record<string, unknown> => ({
        id: `c${index}`,
        name: 'C',
        engine: 'postgres',
        values: {},
        secrets,
      })),
    });

    const parsed: DatabaseDocument | null = parseDatabaseDocument(text);

    expect(parsed?.connections).toHaveLength(malformed.length);
    expect(
      parsed?.connections.some(
        (connection: DatabaseConnection): boolean => 'secrets' in connection,
      ),
    ).toBe(false);
  });

  it('dropsAMalformedPassphraseLock', (): void => {
    for (const passphrase of ['secret', null, { salt: 's' }, { salt: 's', check: 1 }]) {
      const parsed: DatabaseDocument | null = parseDatabaseDocument(
        JSON.stringify({ ...valid, passphrase }),
      );

      expect(parsed).not.toBeNull();
      expect(parsed !== null && 'passphrase' in parsed).toBe(false);
    }
  });

  it('stillOpensVersionOne', (): void => {
    const versionOne: DatabaseDocument = { ...valid, version: 1 };

    expect(parseDatabaseDocument(JSON.stringify(versionOne))).toEqual(versionOne);
  });

  it('refusesVersionThree', (): void => {
    expect(parseDatabaseDocument(JSON.stringify({ ...valid, version: 3 }))).toBeNull();
  });

  it('refusesAConnectionThatIsNotAnObject_ratherThanThrowing', (): void => {
    expect(parseDatabaseDocument(JSON.stringify({ ...valid, connections: [null] }))).toBeNull();
    expect(parseDatabaseDocument(JSON.stringify({ ...valid, connections: ['x'] }))).toBeNull();
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
