import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import type { DebugProtocol } from '@vscode/debugprotocol';
import { DebugAdapterId } from '@shared/api/debug-channels';
import { DapMessageDecoder, DapProtocol, encodeMessage } from './dap-protocol';
import { DebugAdapterSpec } from './debug-adapter-registry';

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
 * Drives a single debug adapter over its standard streams: it spawns the adapter, frames DAP messages
 * with the same `Content-Length` transport the LSP layer uses, and correlates requests, responses, and
 * events through the pure {@link DapProtocol}. It is the Node-side shell around that protocol; the
 * main-process debug manager (a later phase) owns one client per session and bridges it to the renderer.
 *
 * A client is used once: {@link start} spawns and initializes the adapter, thereafter {@link sendRequest}
 * and {@link onEvent} drive and observe it, and {@link dispose} tears it down.
 */
export class DapClient {
  /**
   * Holds the adapter spawn specification.
   */
  private readonly spec: DebugAdapterSpec;

  /**
   * Holds the absolute working directory the adapter is spawned in.
   */
  private readonly cwd: string;

  /**
   * Reassembles whole DAP messages from the adapter's output stream.
   */
  private readonly decoder: DapMessageDecoder = new DapMessageDecoder();

  /**
   * Correlates requests, responses, and events; wired to write to the adapter's input on construction.
   */
  private readonly protocol: DapProtocol;

  /**
   * Holds the spawned adapter process once started.
   */
  private child: ChildProcessWithoutNullStreams | null = null;

  /**
   * Holds the registered process-exit listeners.
   */
  private readonly exitListeners: Set<(code: number | null, signal: string | null) => void> =
    new Set<(code: number | null, signal: string | null) => void>();

  /**
   * Initializes a new instance of the {@link DapClient} class.
   * @param spec The adapter spawn specification.
   * @param cwd The absolute working directory to spawn the adapter in.
   */
  public constructor(spec: DebugAdapterSpec, cwd: string) {
    this.spec = spec;
    this.cwd = cwd;
    this.protocol = new DapProtocol((message: DebugProtocol.ProtocolMessage): void =>
      this.write(message),
    );
  }

  /**
   * Spawns the adapter and wires its streams. Rejects when the process cannot be spawned.
   * @returns Returns a promise that resolves once the adapter process is running and wired.
   */
  public start(): Promise<void> {
    return new Promise<void>((resolve: () => void, reject: (reason: Error) => void): void => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(this.spec.command, [...this.spec.args], {
          cwd: this.cwd,
          env: { ...process.env, ...this.spec.env },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error('Failed to spawn adapter'));
        return;
      }
      // Drain stderr so a chatty adapter cannot stall on a full pipe; its contents are diagnostic only.
      child.stderr.resume();
      child.stdout.on('data', (chunk: Buffer): void => this.receive(chunk));
      child.on('error', (error: Error): void => reject(error));
      child.on('exit', (code: number | null, signal: NodeJS.Signals | null): void =>
        this.handleExit(code, signal),
      );
      this.child = child;
      resolve();
    });
  }

  /**
   * Runs the `initialize` request and resolves with the adapter's advertised capabilities, bounded by a
   * timeout. It deliberately does **not** wait for the `initialized` event: per the DAP specification
   * that event fires only after the client has sent `launch`/`attach`, so awaiting it here would
   * deadlock a spec-compliant adapter (netcoredbg). The event flows through {@link onEvent} instead, so
   * the launch orchestration can send configuration (`setBreakpoints`, `configurationDone`) when it
   * arrives.
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
      supportsRunInTerminalRequest: false,
      supportsProgressReporting: false,
    };
    const capabilities: DebugProtocol.Capabilities = await this.withTimeout(
      this.protocol.sendRequest<DebugProtocol.Capabilities>('initialize', args),
      INITIALIZE_TIMEOUT_MS,
    );
    return capabilities ?? {};
  }

  /**
   * Sends a DAP request to the adapter and resolves with its response body.
   * @param command The DAP request command.
   * @param args The request arguments, or undefined when the command takes none.
   * @returns Returns the response body, typed by the caller.
   */
  public sendRequest<T = unknown>(command: string, args?: unknown): Promise<T> {
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
   * Registers a listener for the adapter process exiting.
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
   * Tears the client down: rejects in-flight requests and kills the adapter process. Safe to call
   * repeatedly.
   */
  public dispose(): void {
    this.protocol.dispose('The debug adapter connection was closed.');
    if (this.child !== null) {
      try {
        this.child.kill();
      } catch {
        // Best-effort cleanup; ignore kill failures.
      }
      this.child = null;
    }
  }

  /**
   * Feeds a received output chunk through the decoder and dispatches every complete message.
   * @param chunk The received bytes.
   */
  private receive(chunk: Buffer): void {
    for (const message of this.decoder.append(chunk)) {
      this.protocol.handleMessage(message);
    }
  }

  /**
   * Writes an outgoing message to the adapter's standard input, framed for the wire.
   * @param message The message to send.
   */
  private write(message: DebugProtocol.ProtocolMessage): void {
    this.child?.stdin.write(encodeMessage(message));
  }

  /**
   * Handles the adapter process exiting: notifies listeners and rejects any in-flight requests.
   * @param code The process exit code, or null when terminated by a signal.
   * @param signal The terminating signal, or null when exited normally.
   */
  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.protocol.dispose('The debug adapter process exited.');
    for (const listener of this.exitListeners) {
      listener(code, signal ?? null);
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
          reject(reason instanceof Error ? reason : new Error('Adapter initialization failed'));
        },
      );
    });
  }
}
