import {
  HostingAuthMode,
  HostingDescription,
  HostingOp,
  HostingParams,
  HostingResponse,
} from '@shared/api/hosting-protocol';

/**
 * Answers a plugin's request for a host's credential: the credential, or null when Studio holds none or
 * will not hand it over.
 */
export type HostingCredentialSource = (host: string) => Promise<string | null>;

/**
 * Something the hosting host can ask the protocol's questions: a plugin's process, through
 * {@link import('./hosting-client').HostingClient}, or a provider running in the main process itself.
 */
export interface HostingEndpoint {
  /**
   * Gets whether the endpoint has completed its handshake and can be asked things.
   */
  readonly running: boolean;

  /**
   * Starts the endpoint and completes the initialize handshake.
   * @param auth The user's sign-in choice for each host that has one.
   * @returns Returns what it said it is, or null when it could not be started.
   */
  start(auth: Readonly<Record<string, HostingAuthMode>>): Promise<HostingDescription | null>;

  /**
   * Asks the endpoint to perform an operation. Always resolves — to the answer, or to a failure.
   * @param op The operation.
   * @param params The operation's parameters.
   * @param timeoutMs How long to wait before abandoning it.
   * @returns Returns the answer.
   */
  request<Op extends HostingOp>(
    op: Op,
    params: HostingParams<Op>,
    timeoutMs: number,
  ): Promise<HostingResponse<Op>>;

  /**
   * Stops the endpoint and fails anything in flight.
   */
  dispose(): void;
}
