import { ConnectionValues } from './database-engine-protocol';

/**
 * The moniker a database document carries, so a `*.database.json` someone else wrote is not mistaken
 * for one.
 */
export const DATABASE_DOCUMENT_KIND: string = 'onixlabs.studio.database';

/**
 * The suffix a database document's file name ends with.
 */
export const DATABASE_DOCUMENT_SUFFIX: string = '.database.json';

/**
 * The schema version this application writes. Version 2 (#1097) added remembered secrets — sealed,
 * never plaintext — and the optional passphrase lock; a version 1 document has neither and still opens.
 */
export const DATABASE_DOCUMENT_VERSION: number = 2;

/**
 * How a connection's remembered secrets are sealed.
 *
 * - `machine`: with the operating system keychain's key, so they open without asking on the machine
 *   that saved them and nowhere else.
 * - `passphrase`: with a key derived from the document's passphrase, so they open anywhere for
 *   whoever knows it.
 */
export type SecretScheme = 'machine' | 'passphrase';

/**
 * A connection's remembered secrets, sealed by main. Only main can open them; the renderer stores and
 * returns them as they are.
 */
export interface SealedSecrets {
  /**
   * Gets how they are sealed.
   */
  readonly scheme: SecretScheme;

  /**
   * Gets the sealed bytes, base64.
   */
  readonly data: string;
}

/**
 * The lock a passphrase puts on a document: what deriving its key needs, and a sealed known value that
 * proves a passphrase right or wrong before any secret is opened with it.
 */
export interface PassphraseLock {
  /**
   * Gets the key derivation's salt, base64.
   */
  readonly salt: string;

  /**
   * Gets the sealed check value, base64.
   */
  readonly check: string;
}

/**
 * One saved connection. Its secrets are never written as typed: the document is meant to be safe to
 * commit, so a remembered secret is sealed, and one that is not remembered is not written at all.
 */
export interface DatabaseConnection {
  /**
   * Gets the connection's identifier. Stable across copies, so a connection pasted into a second
   * document is recognised as the same one.
   */
  readonly id: string;

  /**
   * Gets the name shown in the tree.
   */
  readonly name: string;

  /**
   * Gets the identifier of the engine that makes the connection.
   */
  readonly engine: string;

  /**
   * Gets the values of the engine's non-secret connection fields.
   */
  readonly values: ConnectionValues;

  /**
   * Gets the connection's remembered secrets, sealed, when the user chose to remember them.
   */
  readonly secrets?: SealedSecrets;
}

/**
 * One saved query.
 */
export interface DatabaseQuery {
  /**
   * Gets the query's identifier, which is also its dock panel's id.
   */
  readonly id: string;

  /**
   * Gets the query's title, shown on its tab.
   */
  readonly title: string;

  /**
   * Gets the connection it runs against, or null when it has none yet.
   */
  readonly connectionId: string | null;

  /**
   * Gets the database it runs against, for an engine that reaches several.
   */
  readonly database?: string;

  /**
   * Gets the query text.
   */
  readonly text: string;
}

/**
 * A Database Explorer document: a set of connections and the queries written against them. One file
 * is one tab; several can be open at once, and the same connection may appear in more than one.
 */
export interface DatabaseDocument {
  readonly kind: string;
  readonly version: number;
  readonly connections: readonly DatabaseConnection[];
  readonly queries: readonly DatabaseQuery[];

  /**
   * Gets the passphrase lock, when the document's secrets are sealed with a passphrase.
   */
  readonly passphrase?: PassphraseLock;
}

/**
 * Determines whether a file name is a database document by its suffix.
 * @param fileName The file name to test.
 * @returns Returns true when the name ends with the database document suffix.
 */
export function isDatabaseDocumentName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(DATABASE_DOCUMENT_SUFFIX);
}

/**
 * Reads a database document from text, refusing rather than half-loading anything this build cannot
 * open: malformed JSON, a foreign moniker, a newer version, missing collections.
 * @param text The file's contents.
 * @returns Returns the document, or null.
 */
export function parseDatabaseDocument(text: string): DatabaseDocument | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate: Partial<DatabaseDocument> = raw;
  if (candidate.kind !== DATABASE_DOCUMENT_KIND) {
    return null;
  }
  if (typeof candidate.version !== 'number' || candidate.version > DATABASE_DOCUMENT_VERSION) {
    return null;
  }
  if (!Array.isArray(candidate.connections) || !Array.isArray(candidate.queries)) {
    return null;
  }
  if (
    !candidate.connections.every(
      (connection: unknown): boolean => typeof connection === 'object' && connection !== null,
    )
  ) {
    return null;
  }
  return {
    kind: DATABASE_DOCUMENT_KIND,
    version: candidate.version,
    connections: (candidate.connections as readonly DatabaseConnection[]).map(
      (connection: DatabaseConnection): DatabaseConnection => {
        // A secret that is not a well-formed seal is dropped rather than carried: it can never open.
        const { secrets, ...rest } = connection;
        return isSealedSecrets(secrets) ? { ...rest, secrets } : rest;
      },
    ),
    queries: candidate.queries as readonly DatabaseQuery[],
    ...(isPassphraseLock(candidate.passphrase) ? { passphrase: candidate.passphrase } : {}),
  };
}

/**
 * Determines whether a value is a well-formed seal.
 * @param value The value.
 * @returns Returns true when it is.
 */
function isSealedSecrets(value: unknown): value is SealedSecrets {
  const candidate: Partial<SealedSecrets> | null =
    typeof value === 'object' && value !== null ? value : null;
  return (
    (candidate?.scheme === 'machine' || candidate?.scheme === 'passphrase') &&
    typeof candidate.data === 'string'
  );
}

/**
 * Determines whether a value is a well-formed passphrase lock.
 * @param value The value.
 * @returns Returns true when it is.
 */
function isPassphraseLock(value: unknown): value is PassphraseLock {
  const candidate: Partial<PassphraseLock> | null =
    typeof value === 'object' && value !== null ? value : null;
  return typeof candidate?.salt === 'string' && typeof candidate.check === 'string';
}
