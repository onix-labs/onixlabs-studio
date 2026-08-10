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
