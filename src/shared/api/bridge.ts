/**
 * Describes the generic renderer↔main messaging transport exposed by the Electron preload as
 * `window.bridge`. It is a dumb pub/sub channel: it names no feature and carries no typed domain API.
 * Each feature owns its own IPC slice — its channel-name constants and request/response types in
 * `features/<f>/api`, a typed client service wrapping this transport in `features/<f>/angular`, and the
 * handler in `features/<f>/electron` — so this contract is the only IPC surface that lives in `shared`.
 *
 * Security is unchanged by the transport being generic: every main-process handler keeps its own
 * argument validation, an {@link invoke} to a channel with no registered handler rejects, and
 * main→renderer delivery is driven by main. The transport changes only *who names the channel*, not
 * the validation guarantees.
 */
export interface Bridge {
  /**
   * Invokes a request/response channel on the main process and resolves with its reply.
   * @param channel The channel name the target handler is registered under.
   * @param args The arguments forwarded to the handler.
   * @returns Returns a promise resolving with the handler's reply, or rejecting when no handler is
   * registered or the handler throws.
   */
  invoke<T>(channel: string, ...args: unknown[]): Promise<T>;

  /**
   * Sends a fire-and-forget message to the main process. No reply is delivered; a channel with no
   * listener is a silent no-op.
   * @param channel The channel name.
   * @param args The arguments forwarded to the listener.
   */
  send(channel: string, ...args: unknown[]): void;

  /**
   * Subscribes to a main→renderer channel, receiving only the payload arguments (the underlying
   * Electron event is stripped by the preload).
   * @param channel The channel name.
   * @param listener The listener invoked with each message's payload arguments.
   * @returns Returns a function that unsubscribes the listener.
   */
  on(channel: string, listener: (...args: unknown[]) => void): () => void;
}
