import {
  VersionControlDescription,
  VersionControlExecutableChoice,
  VersionControlOp,
  VersionControlResponse,
  VcsParams,
} from '@shared/api/version-control-protocol';

/**
 * Something the version-control host can ask the protocol's questions: a plugin's process, through
 * {@link import('./version-control-client').VersionControlClient}, or a provider running in the main
 * process itself — which is what core's own git is until it moves into a plugin (#816, #817).
 */
export interface VersionControlEndpoint {
  /**
   * Gets whether the endpoint has completed its handshake and can be asked things.
   */
  readonly running: boolean;

  /**
   * Starts the endpoint and completes the initialize handshake.
   * @param executable The user's choice of which tool it runs, or null for its default.
   * @returns Returns what it said it is, or null when it could not be started.
   */
  start(
    executable: VersionControlExecutableChoice | null,
  ): Promise<VersionControlDescription | null>;

  /**
   * Asks the endpoint to perform an operation. Always resolves — to the answer, or to a failure.
   * @param op The operation.
   * @param root The absolute repository root it acts on, or undefined for a global operation.
   * @param params The operation's parameters.
   * @param timeoutMs How long to wait before abandoning it.
   * @returns Returns the answer.
   */
  request<Op extends VersionControlOp>(
    op: Op,
    root: string | undefined,
    params: VcsParams<Op>,
    timeoutMs: number,
  ): Promise<VersionControlResponse<Op>>;

  /**
   * Stops the endpoint and fails anything in flight.
   */
  dispose(): void;
}
