import {
  PackageManagerDescription,
  PackageManagerOp,
  PackageManagerParams,
  PackageManagerResponse,
} from '@shared/api/package-manager-protocol';

/**
 * Something the package-manager host can ask the protocol's questions.
 */
export interface PackageManagerEndpoint {
  /**
   * Gets whether the endpoint has completed its handshake and can be asked things.
   */
  readonly running: boolean;

  /**
   * Starts the endpoint and completes the initialize handshake.
   * @returns Returns what it said it is, or null when it could not be started.
   */
  start(): Promise<PackageManagerDescription | null>;

  /**
   * Asks the endpoint to perform an operation. Always resolves — to the answer, or to a failure.
   * @param op The operation.
   * @param root The absolute folder it acts on.
   * @param params The operation's parameters.
   * @param timeoutMs How long to wait before abandoning it.
   * @returns Returns the answer.
   */
  request<Op extends PackageManagerOp>(
    op: Op,
    root: string,
    params: PackageManagerParams<Op>,
    timeoutMs: number,
  ): Promise<PackageManagerResponse<Op>>;

  /**
   * Stops the endpoint and fails anything in flight.
   */
  dispose(): void;
}
