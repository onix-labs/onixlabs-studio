/**
 * Names the API Explorer's IPC channels. This is the feature's slice of the IPC contract: the
 * renderer client and the main-process
 * {@link import('../electron/contributions/api-client/api-client.contribution').ApiClientContribution}
 * name their channels from here, over the generic {@link import('./bridge').Bridge} transport. The
 * backend is contributed through the main-process contribution registry (#389); it is not a core
 * manager.
 *
 * Requests run in main rather than in the renderer deliberately. The renderer is a browser context:
 * it would apply CORS to every call, could not set a forbidden header such as `Host` or `Origin`, and
 * could not see a redirect chain it did not follow. Main has none of those limits, so what the user
 * sends is what goes on the wire.
 */
export enum ApiClientChannel {
  /**
   * Performs one resolved request and resolves its outcome (invoke). Never rejects: a transport
   * failure comes back as a failure outcome, so the caller has one shape to render.
   */
  Send = 'api-client:send',

  /**
   * Aborts an in-flight request by its identifier (send). The pending {@link Send} then resolves as a
   * cancelled failure rather than rejecting.
   */
  Cancel = 'api-client:cancel',
}
