import {
  CREATE_DATABASE_QUERY,
  LIST_DATABASE_CONNECTIONS,
  LIST_DATABASE_OBJECTS,
  LIST_DATABASE_QUERIES,
  RUN_DATABASE_QUERY,
  SCRIPT_DATABASE_OBJECT,
  UPDATE_DATABASE_QUERY,
} from '@shared/api/ai-types';
import type { AgentRunContext } from './agent-provider';
import { logger } from '../logger';

/**
 * How long a query may run before the bridge gives up waiting for it, in milliseconds. A query is not
 * a quick lookup — a report over a large table can take a while — so the bridge's 15-second default
 * would cut a legitimate one off.
 */
const RUN_QUERY_TIMEOUT_MS: number = 10 * 60 * 1000;

/**
 * The most characters of a run's results handed back to the model. The user has every row in the
 * grid; the model needs enough to reason about, not a table dump that fills its context window.
 */
const MAX_RESULT_CHARS: number = 24_000;

/**
 * Appended to the system prompt for a Database Explorer run, so the model knows what it is docked to,
 * that structure is free to look at and data is not, and that it writes queries into the document
 * rather than into the conversation.
 */
export const DATABASE_PROMPT_APPENDIX: string = [
  'You are running inside ONIXLabs Studio, docked to a Database Explorer tab: a set of database',
  'connections (SQLite, PostgreSQL, Neo4j and others) and the queries written against them.',
  `- "${LIST_DATABASE_CONNECTIONS}" lists the connections, their engines, and whether each is connected.`,
  `- "${LIST_DATABASE_OBJECTS}" lists what is under a node of a connection's object tree — databases,`,
  '  schemas, tables, views, columns with their types and keys, indexes, constraints; for a graph',
  '  database, labels, relationship types and property keys. Start with no path for the top of the',
  '  tree, then pass a returned path to go deeper. This reads structure only, never data.',
  `- "${SCRIPT_DATABASE_OBJECT}" returns the script a node's action writes (a table's CREATE, a view's`,
  '  definition) without running it. Use it to read exact definitions.',
  `- "${LIST_DATABASE_QUERIES}" lists the document's saved queries and their text.`,
  `- "${CREATE_DATABASE_QUERY}" writes a new query into the document and opens it for the user.`,
  `- "${UPDATE_DATABASE_QUERY}" changes a saved query's text, title, connection or database.`,
  `- "${RUN_DATABASE_QUERY}" runs a saved query and returns its results. It reads the user's data, so`,
  '  the user is asked for permission every time.',
  'Inspect the structure freely to understand the schema before writing a query: use the real table,',
  'column, label and relationship names rather than guessing them, and write in the dialect the',
  "connection's engine speaks (SQL for SQLite, PostgreSQL's SQL for PostgreSQL, Cypher for Neo4j).",
  'Write queries into the document with the create and update tools, so the user can read them, run',
  'them and keep them; do not only paste them into the conversation.',
  'Running a query reads data. Run one when the user asks you to, or when you genuinely need its',
  'result to answer them, and say why. Never run a statement that changes data or structure',
  '(INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, MERGE, SET, DETACH DELETE) unless the user asked',
  'for that change. Prefer a LIMIT when exploring.',
].join('\n');

/**
 * Renders a capability's refusal, or a note that no Database Explorer tab is answering.
 * @param result The capability's answer.
 * @param fallback What to say when it gave no reason.
 * @returns Returns the message for the model.
 */
function refusal(result: { available?: boolean; error?: string }, fallback: string): string {
  if (result.available === false) {
    return 'No Database Explorer tab is answering, so there is nothing to act on.';
  }
  return result.error ?? fallback;
}

/**
 * Reads an answer as a record, whatever came back.
 * @param result The capability's answer.
 * @returns Returns the answer as a record.
 */
function asRecord(result: unknown): Record<string, unknown> {
  return result !== null && typeof result === 'object' ? (result as Record<string, unknown>) : {};
}

/**
 * Reads a text field of an answer, falling back when it is missing or not text.
 * @param record The answer.
 * @param key The field.
 * @param fallback What to use instead.
 * @returns Returns the field's text.
 */
function field(record: Record<string, unknown>, key: string, fallback: string): string {
  const value: unknown = record[key];
  return typeof value === 'string' && value !== '' ? value : fallback;
}

/**
 * Lists the Database Explorer's connections.
 * @param context The agent run context (carries the bridge).
 * @returns Returns the connections as JSON, or why there are none.
 */
export async function listDatabaseConnections(context: AgentRunContext): Promise<string> {
  logger.trace('DatabaseTools', `Tool invoked: ${LIST_DATABASE_CONNECTIONS}`);
  const read: Record<string, unknown> = asRecord(
    await context.bridge.request(LIST_DATABASE_CONNECTIONS, {}),
  );
  if (read['ok'] !== true) {
    return refusal(read, 'The connections could not be listed.');
  }
  const connections: unknown[] = Array.isArray(read['connections']) ? read['connections'] : [];
  return connections.length === 0
    ? 'The document has no connections yet. Ask the user to add one with New Connection.'
    : `Connections:\n${JSON.stringify(connections, null, 2)}`;
}

/**
 * Lists the children of a node of a connection's object tree.
 * @param context The agent run context (carries the bridge).
 * @param input The connection id and the node's path.
 * @returns Returns the nodes as JSON, or why they could not be read.
 */
export async function listDatabaseObjects(
  context: AgentRunContext,
  input: { readonly connection_id: string; readonly path?: string },
): Promise<string> {
  logger.trace('DatabaseTools', `Tool invoked: ${LIST_DATABASE_OBJECTS}`);
  const read: Record<string, unknown> = asRecord(
    await context.bridge.request(LIST_DATABASE_OBJECTS, input, 60_000),
  );
  if (read['ok'] !== true) {
    return refusal(read, 'The objects could not be listed.');
  }
  const nodes: unknown[] = Array.isArray(read['nodes']) ? read['nodes'] : [];
  return nodes.length === 0
    ? 'This node has nothing under it.'
    : `Objects:\n${JSON.stringify(nodes, null, 2)}`;
}

/**
 * Produces the script a node's action writes, without running it.
 * @param context The agent run context (carries the bridge).
 * @param input The connection id, the node's path and the action.
 * @returns Returns the script, or why it could not be produced.
 */
export async function scriptDatabaseObject(
  context: AgentRunContext,
  input: { readonly connection_id: string; readonly path: string; readonly action: string },
): Promise<string> {
  logger.trace('DatabaseTools', `Tool invoked: ${SCRIPT_DATABASE_OBJECT}`);
  const read: Record<string, unknown> = asRecord(
    await context.bridge.request(SCRIPT_DATABASE_OBJECT, input, 60_000),
  );
  if (read['ok'] !== true) {
    return refusal(read, 'The script could not be produced.');
  }
  return `${field(read, 'title', 'Script')}:\n${field(read, 'text', '')}`;
}

/**
 * Lists the document's saved queries.
 * @param context The agent run context (carries the bridge).
 * @returns Returns the queries as JSON.
 */
export async function listDatabaseQueries(context: AgentRunContext): Promise<string> {
  logger.trace('DatabaseTools', `Tool invoked: ${LIST_DATABASE_QUERIES}`);
  const read: Record<string, unknown> = asRecord(
    await context.bridge.request(LIST_DATABASE_QUERIES, {}),
  );
  if (read['ok'] !== true) {
    return refusal(read, 'The queries could not be listed.');
  }
  const queries: unknown[] = Array.isArray(read['queries']) ? read['queries'] : [];
  return queries.length === 0
    ? 'The document has no saved queries yet.'
    : `Queries:\n${JSON.stringify(queries, null, 2)}`;
}

/**
 * Writes a new query into the document and opens it.
 * @param context The agent run context (carries the bridge).
 * @param input The query to write.
 * @returns Returns a confirmation, or why it was refused.
 */
export async function createDatabaseQuery(
  context: AgentRunContext,
  input: Record<string, unknown>,
): Promise<string> {
  logger.trace('DatabaseTools', `Tool invoked: ${CREATE_DATABASE_QUERY}`);
  const write: Record<string, unknown> = asRecord(
    await context.bridge.request(CREATE_DATABASE_QUERY, input),
  );
  if (write['ok'] !== true) {
    return refusal(write, 'The query could not be created.');
  }
  return `Created "${field(write, 'title', 'query')}" (id ${field(write, 'id', '')}) and opened it for the user.`;
}

/**
 * Changes a saved query.
 * @param context The agent run context (carries the bridge).
 * @param input The query's id and the fields to change.
 * @returns Returns a confirmation, or why it was refused.
 */
export async function updateDatabaseQuery(
  context: AgentRunContext,
  input: Record<string, unknown>,
): Promise<string> {
  logger.trace('DatabaseTools', `Tool invoked: ${UPDATE_DATABASE_QUERY}`);
  const write: Record<string, unknown> = asRecord(
    await context.bridge.request(UPDATE_DATABASE_QUERY, input),
  );
  if (write['ok'] !== true) {
    return refusal(write, 'The query could not be updated.');
  }
  return `Updated query ${field(input, 'id', '')}.`;
}

/**
 * Runs a saved query and renders what it produced for the model: its messages, then each result
 * set's columns and first rows, cut to a size the model can reason about.
 * @param context The agent run context (carries the bridge).
 * @param id The query's id.
 * @returns Returns the rendered outcome.
 */
export async function runDatabaseQuery(context: AgentRunContext, id: string): Promise<string> {
  logger.trace('DatabaseTools', `Tool invoked: ${RUN_DATABASE_QUERY} (${id})`);
  const ran: Record<string, unknown> = asRecord(
    await context.bridge.request(RUN_DATABASE_QUERY, { id }, RUN_QUERY_TIMEOUT_MS),
  );
  if (ran['ok'] !== true) {
    return refusal(ran, 'The query could not be run.');
  }
  const state: string =
    ran['cancelled'] === true ? 'cancelled' : ran['failed'] === true ? 'failed' : 'completed';
  const rendered: string = [
    `The query ${state} in ${Math.round(Number(ran['elapsedMs'] ?? 0))} ms.`,
    `Messages:\n${JSON.stringify(ran['messages'] ?? [], null, 2)}`,
    `Result sets:\n${JSON.stringify(ran['resultSets'] ?? [], null, 2)}`,
  ].join('\n\n');
  logger.info('DatabaseTools', `Ran database query ${id}: ${state}`);
  return rendered.length > MAX_RESULT_CHARS
    ? `${rendered.slice(0, MAX_RESULT_CHARS)}\n… (cut short; the user has every row in the grid)`
    : rendered;
}

/**
 * Describes a run for the permission prompt and the audit record: which query, against which
 * connection, and the text that will run — so the user decides on the SQL or Cypher itself rather
 * than on an id.
 * @param context The agent run context (carries the bridge).
 * @param id The query's id.
 * @returns Returns a promise resolving the prompt's detail.
 */
export async function describeDatabaseRun(context: AgentRunContext, id: string): Promise<string> {
  const read: Record<string, unknown> = asRecord(
    await context.bridge.request(LIST_DATABASE_QUERIES, {}),
  );
  const queries: Record<string, unknown>[] = Array.isArray(read['queries'])
    ? (read['queries'] as Record<string, unknown>[])
    : [];
  const query: Record<string, unknown> | undefined = queries.find(
    (candidate: Record<string, unknown>): boolean => candidate['id'] === id,
  );
  if (query === undefined) {
    return `Run saved query ${id} and read the rows it returns.`;
  }
  const where: string = [query['connection'], query['database']]
    .filter((part: unknown): boolean => typeof part === 'string' && part !== '')
    .join(' · ');
  return `Run "${field(query, 'title', id)}"${where === '' ? '' : ` on ${where}`} and read the rows it returns:\n${field(query, 'text', '')}`;
}
