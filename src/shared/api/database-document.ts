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
 * The schema version this application writes.
 */
export const DATABASE_DOCUMENT_VERSION: number = 1;

/**
 * One saved connection. Secrets are never part of it: the document is meant to be safe to commit.
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
  return {
    kind: DATABASE_DOCUMENT_KIND,
    version: candidate.version,
    connections: candidate.connections as readonly DatabaseConnection[],
    queries: candidate.queries as readonly DatabaseQuery[],
  };
}
