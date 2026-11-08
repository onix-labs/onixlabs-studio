/**
 * Names the notification jdtls says how it is with (#1208): `{ type, message }`, where the type is
 * `Starting`, `Started`, `ServiceReady`, `ProjectStatus`, `Message` or `Error`.
 */
export const LANGUAGE_STATUS_METHOD: string = 'language/status';

/**
 * How a server is, in the shape rust-analyzer sends it (`experimental/serverStatus`, #1210), which
 * the status row already reads.
 */
export interface LspServerStatus {
  /**
   * Gets whether the server is working as it should.
   */
  readonly health: 'ok' | 'warning' | 'error';

  /**
   * Gets whether it has finished loading: false while it is, true once it has.
   */
  readonly quiescent: boolean;

  /**
   * Gets what is wrong, when something is.
   */
  readonly message?: string;
}

/**
 * Reads jdtls's `language/status` as the server status the status row reads (#1208), so a Java
 * workspace shows as loading until jdtls has imported it, rather than as ready at its first answer.
 * `Starting` means it is loading and `ServiceReady` that it has finished; `Error` that it could not
 * start. jdtls says `Starting` once more after `Started`; one after `ServiceReady`, should it come, is
 * not read as a new load, since nothing would end it. `Started`, `ProjectStatus` and `Message` change
 * nothing the row shows.
 * @param params The notification's parameters, untrusted.
 * @param ready Whether the server has already said it is ready.
 * @returns Returns the status to report, or null for a notification that changes nothing.
 */
export function serverStatusOf(params: unknown, ready: boolean): LspServerStatus | null {
  const { type, message } = (params ?? {}) as { type?: unknown; message?: unknown };
  switch (type) {
    case 'Starting':
      return ready ? null : { health: 'ok', quiescent: false };
    case 'ServiceReady':
      return { health: 'ok', quiescent: true };
    case 'Error':
      return {
        health: 'error',
        quiescent: true,
        message:
          typeof message === 'string' && message.length > 0
            ? message
            : 'The Java language server could not start.',
      };
    default:
      return null;
  }
}
