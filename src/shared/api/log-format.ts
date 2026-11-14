/**
 * Shared serialisation for structured log detail. Both the main-process {@link import('../electron/logger').Logger}
 * and the renderer {@link import('../angular/services/log/log').Log} service format their `(message,
 * ...details)` the same way, so a caller can pass an `Error` or an object as detail and get a
 * consistent, length-capped line — the "exceptions logged as errors" contract relies on an `Error`'s
 * stack surviving into the record.
 */

/**
 * Serialises one detail value to a string: strings pass through, `Error`s keep their stack, and other
 * values are JSON-encoded with a string fallback for circular structures.
 * @param value The detail value.
 * @returns Returns the serialised string.
 */
export function serializeDetail(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Appends serialised detail to a message. With no detail the message is returned unchanged; otherwise
 * each detail is serialised and space-joined onto the message.
 * @param message The primary message.
 * @param details The detail values (objects, errors, …).
 * @returns Returns the combined message.
 */
export function appendDetails(message: string, details: readonly unknown[]): string {
  if (details.length === 0) {
    return message;
  }
  return `${message} ${details.map(serializeDetail).join(' ')}`;
}

/**
 * The most detail values a record keeps; any beyond are dropped.
 */
export const MAX_LOG_DETAILS: number = 8;

/**
 * The most characters one serialised detail keeps.
 */
export const MAX_LOG_DETAIL_LENGTH: number = 8192;

/**
 * Serialises a message's detail values for a record, each capped, or undefined when there are none.
 * The record keeps them apart from its message, so the message reads cleanly and each detail (an
 * object's JSON, an error's stack) can be shown whole.
 * @param details The detail values.
 * @returns Returns the serialised details, or undefined when there are none.
 */
export function serializeDetails(details: readonly unknown[]): readonly string[] | undefined {
  if (details.length === 0) {
    return undefined;
  }
  return details
    .slice(0, MAX_LOG_DETAILS)
    .map((value: unknown): string => serializeDetail(value).slice(0, MAX_LOG_DETAIL_LENGTH));
}

/**
 * Reads untrusted serialised details (a renderer's payload): an array of strings, capped, or undefined
 * when it is not one or is empty.
 * @param value The untrusted value.
 * @returns Returns the details, or undefined.
 */
export function sanitizeDetails(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const details: string[] = (value as unknown[])
    .filter((item: unknown): item is string => typeof item === 'string')
    .slice(0, MAX_LOG_DETAILS)
    .map((item: string): string => item.slice(0, MAX_LOG_DETAIL_LENGTH));
  return details.length > 0 ? details : undefined;
}

/**
 * Gets a record's full text: its message with its details appended, as a single line of a terminal,
 * a copied log or a model's tool result shows it.
 * @param record The record's message and details.
 * @param record.message The message.
 * @param record.details The serialised details, where it has any.
 * @returns Returns the full text.
 */
export function fullMessage(record: {
  readonly message: string;
  readonly details?: readonly string[];
}): string {
  return appendDetails(record.message, record.details ?? []);
}
