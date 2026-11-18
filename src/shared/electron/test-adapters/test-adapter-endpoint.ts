import {
  TestAdapterDescription,
  TestAdapterOp,
  TestAdapterParams,
  TestAdapterResponse,
} from '@shared/api/test-adapter-protocol';
import type { RunToken } from '../process/launch';

/**
 * Something the test-adapter host can ask the protocol's questions.
 */
export interface TestAdapterEndpoint {
  /**
   * Gets whether the endpoint has completed its handshake and can be asked things.
   */
  readonly running: boolean;

  /**
   * Starts the endpoint and completes the initialize handshake.
   * @returns Returns what it said it is, or null when it could not be started.
   */
  start(): Promise<TestAdapterDescription | null>;

  /**
   * Asks the endpoint to perform an operation. Always resolves — to the answer, or to a failure.
   * @param op The operation.
   * @param token The folder's run token: work for a folder is sent only with it (#1504).
   * @param params The operation's parameters.
   * @param timeoutMs How long to wait before abandoning it.
   * @returns Returns the answer.
   */
  request<Op extends TestAdapterOp>(
    op: Op,
    token: RunToken,
    params: TestAdapterParams<Op>,
    timeoutMs: number,
  ): Promise<TestAdapterResponse<Op>>;

  /**
   * Stops the endpoint and fails anything in flight.
   */
  dispose(): void;
}
