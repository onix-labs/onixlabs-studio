import type {
  LiveServerDescription,
  LiveServerOp,
  LiveServerParams,
  LiveServerResponse,
} from '@shared/api/live-server-protocol';

/**
 * Something the live-server host can ask the protocol's questions.
 */
export interface LiveServerEndpoint {
  /**
   * Gets whether the endpoint has completed its handshake and can be asked things.
   */
  readonly running: boolean;

  /**
   * Starts the endpoint and completes the initialize handshake.
   * @returns Returns what it said it is, or null when it could not be started.
   */
  start(): Promise<LiveServerDescription | null>;

  /**
   * Asks the endpoint to perform an operation. Always resolves — to the answer, or to a failure.
   * @param op The operation.
   * @param params The operation's parameters.
   * @param timeoutMs How long to wait before abandoning it.
   * @returns Returns the answer.
   */
  request<Op extends LiveServerOp>(
    op: Op,
    params: LiveServerParams<Op>,
    timeoutMs: number,
  ): Promise<LiveServerResponse<Op>>;

  /**
   * Stops the endpoint and fails anything in flight.
   */
  dispose(): void;
}
