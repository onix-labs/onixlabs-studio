import type { DebugProtocol } from '@vscode/debugprotocol';
import { DebugAdapterId } from '@shared/api/debug-channels';
import { logger } from '../logger';
import { DapMessageDecoder, DapProtocol, encodeMessage } from './dap-protocol';
import { DapTransport } from './dap-transport';

/**
 * Specifies how long, in milliseconds, to wait for an adapter's `initialize` handshake before giving up
 * and tearing it down. Errs long, like the LSP initialize timeout: a slow-but-alive adapter torn down
 * mid-handshake would only be re-spawned to time out again.
 */
const INITIALIZE_TIMEOUT_MS: number = 30000;

/**
 * The client identity advertised to every adapter in the `initialize` request.
 */
const CLIENT_ID: string = 'onixlabs-studio';

/**
 * The surface the {@link import('./debug-manager').DebugManager} drives a debug session through, whether
 * it is a single stdio adapter ({@link DapClient}) or a multi-connection compound session ({@link
 * import('./js-debug-session').JsDebugSession}). The manager only ever sees this interface, so the
 * multiplexing js-debug requires stays hidden behind it.
 */
export interface DebugAdapterConnection {
  /**
   * Establishes the connection (spawns or connects the adapter). Rejects when it cannot be established.
   * @returns Returns a promise that resolves once the connection is ready.
   */
  start(): Promise<void>;

  /**
   * Runs the `initialize` handshake and resolves with the adapter's advertised capabilities.
   * @param adapterId The adapter id, advertised as the `adapterID`.
   * @returns Returns the adapter's capabilities.
   */
  initialize(adapterId: DebugAdapterId): Promise<DebugProtocol.Capabilities>;

  /**
   * Sends a DAP request and resolves with its response body.
   * @param command The DAP request command.
   * @param args The request arguments, or undefined when the command takes none.
   * @returns Returns the response body.
   */
  sendRequest<T = unknown>(command: string, args?: unknown): Promise<T>;

  /**
   * Registers a listener for adapter events.
   * @param listener The listener to add.
   * @returns Returns a disposer that removes the listener.
   */
  onEvent(listener: (event: DebugProtocol.Event) => void): () => void;

  /**
   * Registers a listener for the connection closing (the adapter process or server exiting).
   * @param listener The listener to add.
   * @returns Returns a disposer that removes the listener.
   */
  onExit(listener: (code: number | null, signal: string | null) => void): () => void;

  /**
   * Registers a listener for the adapter's `runInTerminal` reverse requests, each delivered with a
   * bound responder so the answer reaches the requesting connection (a js-debug target's request must
   * be answered on that target).
   * @param listener The listener to add.
   * @returns Returns a disposer that removes the listener.
   */
  onRunInTerminal(
    listener: (
      request: DebugProtocol.Request,
      respond: (body?: unknown, success?: boolean) => void,
    ) => void,
  ): () => void;

  /**
   * Tears the connection down. Safe to call repeatedly.
   */
  dispose(): void;
}

/**
 * Drives a single debug adapter over a {@link DapTransport}: it frames DAP messages with the same
 * `Content-Length` transport the LSP layer uses and correlates requests, responses, events, and reverse
 * requests through the pure {@link DapProtocol}. It is the Node-side shell around that protocol; the
 * main-process debug manager owns one client per session (or several, for a compound js-debug session)
 * and bridges it to the renderer.
 *
 * A client is used once: {@link start} establishes the transport, {@link initialize} handshakes, and
 * thereafter {@link sendRequest} and {@link onEvent} drive and observe the adapter until {@link dispose}
 * tears it down.
 */
export class DapClient implements DebugAdapterConnection {
  /**
   * Carries DAP bytes to and from the adapter.
   */
  private readonly transport: DapTransport;

  /**
   * Reassembles whole DAP messages from the adapter's inbound stream.
   */
  private readonly decoder: DapMessageDecoder = new DapMessageDecoder();

  /**
   * Correlates requests, responses, events, and reverse requests; wired to write to the transport on
   * construction.
   */
  private readonly protocol: DapProtocol;

  /**
   * Holds the registered connection-close listeners.
   */
  private readonly exitListeners: Set<(code: number | null, signal: string | null) => void> =
    new Set<(code: number | null, signal: string | null) => void>();

  /**
   * Initializes a new instance of the {@link DapClient} class.
   * @param transport The transport carrying DAP bytes to and from the adapter.
   */
  public constructor(transport: DapTransport) {
    this.transport = transport;
    this.protocol = new DapProtocol((message: DebugProtocol.ProtocolMessage): void =>
      this.transport.send(encodeMessage(message)),
    );
  }

  /**
   * Establishes the transport and wires its data flow and close.
   * @returns Returns a promise that resolves once the transport is ready.
   */
  public async start(): Promise<void> {
    logger.trace('DapClient', 'Starting adapter transport');
    this.transport.onData((chunk: Uint8Array): void => this.receive(chunk));
    this.transport.onClose((code: number | null, signal: string | null): void =>
      this.handleClose(code, signal),
    );
    await this.transport.start();
  }

  /**
   * Runs the `initialize` request and resolves with the adapter's advertised capabilities, bounded by a
   * timeout. It deliberately does **not** wait for the `initialized` event: per the DAP specification
   * that event fires only after the client has sent `launch`/`attach`, so awaiting it here would
   * deadlock a spec-compliant adapter (netcoredbg, js-debug). The event flows through {@link onEvent}
   * instead, so the launch orchestration can send configuration (`setBreakpoints`, `configurationDone`)
   * when it arrives.
   * @param adapterId The adapter id, advertised to the adapter as the `adapterID`.
   * @returns Returns the adapter's advertised capabilities.
   */
  public async initialize(adapterId: DebugAdapterId): Promise<DebugProtocol.Capabilities> {
    const args: DebugProtocol.InitializeRequestArguments = {
      clientID: CLIENT_ID,
      clientName: 'ONIXLabs Studio',
      adapterID: adapterId,
      locale: 'en',
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: 'path',
      // The client hosts debuggees in its interactive run terminals on request, so stdin-reading
      // programs are debuggable; adapters that never ask (or are launched with internalConsole)
      // keep routing output as events.
      supportsRunInTerminalRequest: true,
      supportsProgressReporting: false,
      // js-debug spawns a child target session per debuggee and asks the client to start it with a
      // `startDebugging` reverse request; the compound session handles that, so it is advertised here.
      supportsStartDebuggingRequest: true,
    };
    logger.trace('DapClient', `Sending initialize handshake (${adapterId})`);
    const capabilities: DebugProtocol.Capabilities = await this.withTimeout(
      this.protocol.sendRequest<DebugProtocol.Capabilities>('initialize', args),
      INITIALIZE_TIMEOUT_MS,
    );
    logger.trace('DapClient', `Initialize handshake complete (${adapterId})`);
    return capabilities ?? {};
  }

  /**
   * Sends a DAP request to the adapter and resolves with its response body.
   * @param command The DAP request command.
   * @param args The request arguments, or undefined when the command takes none.
   * @returns Returns the response body, typed by the caller.
   */
  public sendRequest<T = unknown>(command: string, args?: unknown): Promise<T> {
    logger.trace('DapClient', `Dispatching DAP request: ${command}`);
    return this.protocol.sendRequest<T>(command, args);
  }

  /**
   * Registers a listener for adapter events.
   * @param listener The listener to add.
   * @returns Returns a disposer that removes the listener.
   */
  public onEvent(listener: (event: DebugProtocol.Event) => void): () => void {
    return this.protocol.onEvent(listener);
  }

  /**
   * Registers a listener for reverse requests the adapter makes of the client (such as js-debug's
   * `startDebugging`).
   * @param listener The listener to add.
   * @returns Returns a disposer that removes the listener.
   */
  public onReverseRequest(listener: (request: DebugProtocol.Request) => void): () => void {
    return this.protocol.onReverseRequest(listener);
  }

  /**
   * Registers a listener for `runInTerminal` reverse requests, with a responder bound to this
   * connection.
   * @param listener The listener to add.
   * @returns Returns a disposer that removes the listener.
   */
  public onRunInTerminal(
    listener: (
      request: DebugProtocol.Request,
      respond: (body?: unknown, success?: boolean) => void,
    ) => void,
  ): () => void {
    return this.onReverseRequest((request: DebugProtocol.Request): void => {
      if (request.command === 'runInTerminal') {
        listener(request, (body?: unknown, success: boolean = true): void =>
          this.respondTo(request, body, success),
        );
      }
    });
  }

  /**
   * Sends a response to a reverse request the adapter made of the client.
   * @param request The reverse request being answered.
   * @param body The response body, or undefined when the command returns none.
   * @param success Whether the client handled the request; defaults to true.
   */
  public respondTo(request: DebugProtocol.Request, body?: unknown, success: boolean = true): void {
    this.protocol.respondTo(request, body, success);
  }

  /**
   * Registers a listener for the connection closing.
   * @param listener The listener to add.
   * @returns Returns a disposer that removes the listener.
   */
  public onExit(listener: (code: number | null, signal: string | null) => void): () => void {
    this.exitListeners.add(listener);
    return (): void => {
      this.exitListeners.delete(listener);
    };
  }

  /**
   * Tears the client down: rejects in-flight requests and disposes the transport. Safe to call
   * repeatedly.
   */
  public dispose(): void {
    logger.trace('DapClient', 'Disposing adapter connection');
    this.protocol.dispose('The debug adapter connection was closed.');
    this.transport.dispose();
  }

  /**
   * Feeds a received chunk through the decoder and dispatches every complete message.
   * @param chunk The received bytes.
   */
  private receive(chunk: Uint8Array): void {
    for (const message of this.decoder.append(chunk)) {
      this.protocol.handleMessage(message);
    }
  }

  /**
   * Handles the transport closing: notifies listeners and rejects any in-flight requests.
   * @param code The process exit code, or null when closed by a socket or signal.
   * @param signal The terminating signal, or null.
   */
  private handleClose(code: number | null, signal: string | null): void {
    logger.debug('DapClient', `Adapter connection closed (code=${code}, signal=${signal})`);
    this.protocol.dispose('The debug adapter connection closed.');
    for (const listener of this.exitListeners) {
      listener(code, signal);
    }
  }

  /**
   * Rejects a promise if it does not settle within the given time.
   * @param promise The promise to bound.
   * @param timeoutMs The timeout in milliseconds.
   * @returns Returns a promise that resolves with the original value or rejects on timeout.
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve: (value: T) => void, reject: (reason: Error) => void): void => {
      const timer: NodeJS.Timeout = setTimeout((): void => {
        reject(new Error('The debug adapter did not complete initialization in time.'));
      }, timeoutMs);
      promise.then(
        (value: T): void => {
          clearTimeout(timer);
          resolve(value);
        },
        (reason: unknown): void => {
          clearTimeout(timer);
          logger.error('DapClient', 'Adapter initialization failed', reason);
          reject(reason instanceof Error ? reason : new Error('Adapter initialization failed'));
        },
      );
    });
  }
}
