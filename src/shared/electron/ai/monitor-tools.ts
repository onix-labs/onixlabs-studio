import {
  LIST_LOG_SESSIONS,
  QUERY_LOGS,
  READ_SYSTEM_METRICS,
  SET_LOG_LEVEL,
} from '@shared/api/ai-types';
import { logger } from '@shared/electron/logger';
import type { AgentRunContext } from './agent-provider';

// The System Monitor agent's tools (#966). The handlers ask the renderer for what the view knows —
// the log audit and the resource readings it has sampled — through the run's bridge, and render the
// answer for the model. Every answer is bounded: a session runs to tens of thousands of records, and a
// tool that returned them all would spend the context window the model needs to reason about them.

/**
 * The most records one query returns, whatever the model asks for.
 */
export const MAX_LOG_RECORDS: number = 300;

/**
 * The records a query returns when the model names no limit.
 */
const DEFAULT_LOG_RECORDS: number = 100;

/**
 * The most characters of one record's message the model is shown.
 */
const MAX_MESSAGE_CHARS: number = 500;

/**
 * Appended to the system prompt for a System Monitor run, so the model knows what it is docked to, what
 * it can reach, and what it is not for.
 */
export const MONITOR_PROMPT_APPENDIX: string = [
  "You are running inside ONIXLabs Studio, docked to the System Monitor: the app's own log audit and",
  'its resource readings. You help the user understand what the app has been doing. You can:',
  `- "${LIST_LOG_SESSIONS}" lists the app's runs ("sessions") whose logs are kept, newest first.`,
  `- "${QUERY_LOGS}" reads log records, newest first, filtered by session, severity, text and time.`,
  `- "${READ_SYSTEM_METRICS}" summarises the recent CPU, memory, GPU, network and disk readings.`,
  `- "${SET_LOG_LEVEL}" changes how much the app logs, which is a setting that lasts.`,
  'Work from the records rather than from guesses: query narrowly (a severity, a source, a phrase or a',
  'time window) and widen only when that finds nothing. Quote the records that support what you say,',
  'with their times, and say plainly when the logs do not explain something.',
  'Change the log level only when the user asks, or when you need more detail to answer them — and say',
  'that you changed it and how to put it back.',
  'You are kept to this view. You cannot read or change files, run commands, or act anywhere else in',
  'Studio. When the user asks for something outside it, say which part of Studio can help instead.',
].join('\n');

/**
 * One log record as the renderer reports it.
 */
interface ReportedRecord {
  readonly timestamp?: string;
  readonly severity?: string;
  readonly origin?: string;
  readonly window?: string;
  readonly source?: string;
  readonly message?: string;
}

/**
 * Clamps a requested record count into what one query may return.
 * @param limit The count the model asked for, if any.
 * @returns Returns the count to request.
 */
export function clampLogLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_LOG_RECORDS;
  }
  return Math.min(MAX_LOG_RECORDS, Math.max(1, Math.floor(limit)));
}

/**
 * Renders one record as a line: time, severity, where it came from, and its message, shortened.
 * @param record The record.
 * @returns Returns the line.
 */
export function formatLogRecord(record: ReportedRecord): string {
  const message: string = (record.message ?? '').replace(/\s+/g, ' ').trim();
  const shown: string =
    message.length > MAX_MESSAGE_CHARS ? `${message.slice(0, MAX_MESSAGE_CHARS)}…` : message;
  const where: string = [record.origin, record.window].filter(Boolean).join('/');
  return `${record.timestamp ?? '?'} ${(record.severity ?? '?').toUpperCase()} [${where}] ${record.source ?? '?'}: ${shown}`;
}

/**
 * Lists the log sessions through the renderer bridge.
 * @param context The agent run context (carries the bridge).
 * @returns Returns the sessions, or a note that the System Monitor is not open.
 */
export async function listLogSessions(context: AgentRunContext): Promise<string> {
  logger.trace('MonitorTools', `Tool invoked: ${LIST_LOG_SESSIONS}`);
  const result: unknown = await context.bridge.request(LIST_LOG_SESSIONS, {});
  const read: {
    available?: boolean;
    sessions?: { id?: string; startedAt?: string; current?: boolean }[];
  } = result ?? {};
  if (read.available !== true) {
    return 'The System Monitor is not open, so the logs cannot be read.';
  }
  const sessions: { id?: string; startedAt?: string; current?: boolean }[] = read.sessions ?? [];
  if (sessions.length === 0) {
    return 'No log sessions are kept.';
  }
  return sessions
    .map(
      (session: { id?: string; startedAt?: string; current?: boolean }): string =>
        `${session.id ?? '?'} — started ${session.startedAt ?? '?'}${session.current === true ? ' (this run)' : ''}`,
    )
    .join('\n');
}

/**
 * Reads log records through the renderer bridge and renders them, newest first.
 * @param context The agent run context (carries the bridge).
 * @param query What to read.
 * @returns Returns the records, or why there are none.
 */
export async function queryLogs(
  context: AgentRunContext,
  query: {
    readonly session?: string;
    readonly severities?: readonly string[];
    readonly text?: string;
    readonly since?: string;
    readonly until?: string;
    readonly limit?: number;
  },
): Promise<string> {
  const limit: number = clampLogLimit(query.limit);
  logger.trace('MonitorTools', `Tool invoked: ${QUERY_LOGS} (limit ${limit})`);
  const result: unknown = await context.bridge.request(QUERY_LOGS, { ...query, limit });
  const read: {
    available?: boolean;
    error?: string;
    session?: string;
    records?: ReportedRecord[];
    more?: boolean;
  } = result ?? {};
  if (read.available !== true) {
    return 'The System Monitor is not open, so the logs cannot be read.';
  }
  if (read.error !== undefined) {
    return read.error;
  }
  const records: ReportedRecord[] = read.records ?? [];
  logger.debug('MonitorTools', `${QUERY_LOGS}: ${records.length} record(s)`);
  if (records.length === 0) {
    return `No records in session ${read.session ?? '?'} match.`;
  }
  const header: string = `${records.length} record(s) from session ${read.session ?? '?'}, newest first${read.more === true ? ' (more match; narrow the query or raise the limit)' : ''}:`;
  return [header, ...records.map(formatLogRecord)].join('\n');
}

/**
 * Summarises the recent resource readings through the renderer bridge.
 * @param context The agent run context (carries the bridge).
 * @returns Returns the summary, or why there is none.
 */
export async function readSystemMetrics(context: AgentRunContext): Promise<string> {
  logger.trace('MonitorTools', `Tool invoked: ${READ_SYSTEM_METRICS}`);
  const result: unknown = await context.bridge.request(READ_SYSTEM_METRICS, {});
  const read: { available?: boolean; summary?: unknown } = result ?? {};
  if (read.available !== true) {
    return 'The System Monitor is not open, so there are no readings.';
  }
  return JSON.stringify(read.summary ?? {}, null, 2);
}

/**
 * Changes the log level through the renderer bridge.
 * @param context The agent run context (carries the bridge).
 * @param level The level to set.
 * @returns Returns a confirmation, or why it was refused.
 */
export async function setLogLevel(context: AgentRunContext, level: string): Promise<string> {
  logger.trace('MonitorTools', `Tool invoked: ${SET_LOG_LEVEL} (${level})`);
  const result: unknown = await context.bridge.request(SET_LOG_LEVEL, { level });
  const write: { ok?: boolean; error?: string; previous?: string } = result ?? {};
  if (write.ok !== true) {
    return write.error ?? 'The log level could not be changed.';
  }
  logger.info('MonitorTools', `Log level set to ${level}`);
  return `The log level is now "${level}" (it was "${write.previous ?? '?'}"). It is the Log level setting under Settings.`;
}
