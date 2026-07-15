import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { connect, Socket } from 'node:net';

/**
 * How long, in milliseconds, to wait for a TCP debug-server process to announce the port it is listening
 * on before giving up. Errs long, matching the initialize timeout: a slow-but-alive server torn down
 * mid-startup would only be re-spawned to time out again.
 */
const SERVER_LISTEN_TIMEOUT_MS: number = 15000;

/**
 * The byte stream carrying one debug adapter's DAP messages, abstracted over how the adapter is reached:
 * a spawned process's standard streams (netcoredbg) or a TCP socket to a debug server (js-debug). The
 * {@link import('./dap-client').DapClient} frames and correlates DAP messages over whichever transport it
 * is given, so the protocol logic is identical regardless of how the adapter is spoken to.
 */
export interface DapTransport {
  /**
   * Establishes the transport (spawns the process, or connects the socket). Rejects when it cannot be
   * established.
   * @returns Returns a promise that resolves once the transport is ready to carry messages.
   */
  start(): Promise<void>;

  /**
   * Writes a framed DAP message to the adapter.
   * @param framed The `Content-Length`-framed message.
   */
  send(framed: string): void;

  /**
   * Registers the listener that receives raw inbound byte chunks. One listener is registered by the
   * client; chunks are delivered in order.
   * @param listener The chunk listener.
   */
  onData(listener: (chunk: Uint8Array) => void): void;

  /**
   * Registers the listener that fires when the transport closes (the process exits, or the socket
   * closes), ending the session.
   * @param listener The close listener, given the process exit code and signal when known.
   */
  onClose(listener: (code: number | null, signal: string | null) => void): void;

  /**
   * Tears the transport down (kills the process, or destroys the socket). Safe to call repeatedly.
   */
  dispose(): void;
}

/**
 * A DAP transport over a spawned process's standard input and output, framing messages on the child's
 * stdin and reassembling them from its stdout. This is how a stdio adapter such as netcoredbg is spoken
 * to.
 */
export class StdioTransport implements DapTransport {
  /**
   * Holds the executable to spawn.
   */
  private readonly command: string;

  /**
   * Holds the arguments passed to the executable.
   */
  private readonly args: readonly string[];

  /**
   * Holds the environment overlaid on the spawned process's environment.
   */
  private readonly env: Readonly<Record<string, string>> | undefined;

  /**
   * Holds the working directory the process is spawned in.
   */
  private readonly cwd: string;

  /**
   * Holds the spawned process once started.
   */
  private child: ChildProcessWithoutNullStreams | null = null;

  /**
   * Holds the inbound-chunk listener.
   */
  private dataListener: ((chunk: Uint8Array) => void) | null = null;

  /**
   * Holds the close listener.
   */
  private closeListener: ((code: number | null, signal: string | null) => void) | null = null;

  /**
   * Initializes a new instance of the {@link StdioTransport} class.
   * @param command The executable to spawn.
   * @param args The arguments passed to the executable.
   * @param env The environment overlaid on the process, or undefined to inherit unchanged.
   * @param cwd The working directory to spawn the process in.
   */
  public constructor(
    command: string,
    args: readonly string[],
    env: Readonly<Record<string, string>> | undefined,
    cwd: string,
  ) {
    this.command = command;
    this.args = args;
    this.env = env;
    this.cwd = cwd;
  }

  /**
   * Spawns the adapter process and wires its streams.
   * @returns Returns a promise that resolves once the process is running.
   */
  public start(): Promise<void> {
    return new Promise<void>((resolve: () => void, reject: (reason: Error) => void): void => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(this.command, [...this.args], {
          cwd: this.cwd,
          env: { ...process.env, ...this.env },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error('Failed to spawn adapter'));
        return;
      }
      // Drain stderr so a chatty adapter cannot stall on a full pipe; its contents are diagnostic only.
      child.stderr.resume();
      child.stdout.on('data', (chunk: Buffer): void => this.dataListener?.(chunk));
      child.on('error', (error: Error): void => reject(error));
      child.on('exit', (code: number | null, signal: NodeJS.Signals | null): void =>
        this.closeListener?.(code, signal ?? null),
      );
      this.child = child;
      resolve();
    });
  }

  /**
   * Writes a framed message to the process's standard input.
   * @param framed The framed message.
   */
  public send(framed: string): void {
    this.child?.stdin.write(framed);
  }

  /**
   * Registers the inbound-chunk listener.
   * @param listener The chunk listener.
   */
  public onData(listener: (chunk: Uint8Array) => void): void {
    this.dataListener = listener;
  }

  /**
   * Registers the close listener.
   * @param listener The close listener.
   */
  public onClose(listener: (code: number | null, signal: string | null) => void): void {
    this.closeListener = listener;
  }

  /**
   * Kills the spawned process.
   */
  public dispose(): void {
    if (this.child !== null) {
      try {
        this.child.kill();
      } catch {
        // Best-effort cleanup; ignore kill failures.
      }
      this.child = null;
    }
  }
}

/**
 * A DAP transport that spawns a debug-server process which listens on a TCP port, parses the port from
 * the server's announcement, and connects a socket to it. This is how js-debug's `dapDebugServer` is
 * spoken to: the server hosts one or more DAP sessions, and its child target sessions are reached by
 * further sockets to the same port (see {@link TcpClientTransport}). The session ends when the server
 * process exits, so this transport's close reflects the process, not the socket.
 */
export class TcpServerTransport implements DapTransport {
  /**
   * Holds the executable to spawn (the Node runtime hosting the debug server).
   */
  private readonly command: string;

  /**
   * Holds the arguments passed to the executable (the server script and its port/host arguments).
   */
  private readonly args: readonly string[];

  /**
   * Holds the environment overlaid on the spawned process's environment.
   */
  private readonly env: Readonly<Record<string, string>> | undefined;

  /**
   * Holds the working directory the server is spawned in.
   */
  private readonly cwd: string;

  /**
   * Holds the spawned server process once started.
   */
  private child: ChildProcessWithoutNullStreams | null = null;

  /**
   * Holds the socket connected to the server once started.
   */
  private socket: Socket | null = null;

  /**
   * Holds the host the server announced it is listening on, once parsed.
   */
  private listenHost: string = '127.0.0.1';

  /**
   * Holds the port the server announced it is listening on, once parsed.
   */
  private listenPort: number = 0;

  /**
   * Holds the inbound-chunk listener.
   */
  private dataListener: ((chunk: Uint8Array) => void) | null = null;

  /**
   * Holds the close listener.
   */
  private closeListener: ((code: number | null, signal: string | null) => void) | null = null;

  /**
   * Initializes a new instance of the {@link TcpServerTransport} class.
   * @param command The executable to spawn (the Node runtime).
   * @param args The arguments passed to the executable (the server script, port, and host).
   * @param env The environment overlaid on the process, or undefined to inherit unchanged.
   * @param cwd The working directory to spawn the server in.
   */
  public constructor(
    command: string,
    args: readonly string[],
    env: Readonly<Record<string, string>> | undefined,
    cwd: string,
  ) {
    this.command = command;
    this.args = args;
    this.env = env;
    this.cwd = cwd;
  }

  /**
   * Gets the host the debug server is listening on, valid once {@link start} has resolved.
   */
  public get host(): string {
    return this.listenHost;
  }

  /**
   * Gets the port the debug server is listening on, valid once {@link start} has resolved.
   */
  public get port(): number {
    return this.listenPort;
  }

  /**
   * Spawns the debug server, waits for it to announce its port, and connects a socket to it.
   * @returns Returns a promise that resolves once the socket is connected.
   */
  public start(): Promise<void> {
    return new Promise<void>((resolve: () => void, reject: (reason: Error) => void): void => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(this.command, [...this.args], {
          cwd: this.cwd,
          env: { ...process.env, ...this.env },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error('Failed to spawn debug server'));
        return;
      }
      this.child = child;
      const timer: NodeJS.Timeout = setTimeout((): void => {
        reject(new Error('The debug server did not start listening in time.'));
      }, SERVER_LISTEN_TIMEOUT_MS);
      let announced: boolean = false;
      let banner: string = '';
      // The server prints `Debug server listening at <host>:<port>` once ready; parse the port, then
      // connect. Its stderr is diagnostic only and drained so it cannot stall.
      child.stderr.resume();
      child.stdout.on('data', (chunk: Buffer): void => {
        if (announced) {
          return;
        }
        banner += chunk.toString('utf8');
        const match: RegExpExecArray | null = /listening at (?:(.+):)?(\d+)/i.exec(banner);
        if (match === null) {
          return;
        }
        announced = true;
        clearTimeout(timer);
        this.listenHost = match[1] !== undefined && match[1].length > 0 ? match[1] : '127.0.0.1';
        this.listenPort = Number(match[2]);
        this.connectSocket(resolve, reject);
      });
      child.on('error', (error: Error): void => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('exit', (code: number | null, signal: NodeJS.Signals | null): void =>
        this.closeListener?.(code, signal ?? null),
      );
    });
  }

  /**
   * Writes a framed message to the connected socket.
   * @param framed The framed message.
   */
  public send(framed: string): void {
    this.socket?.write(framed);
  }

  /**
   * Registers the inbound-chunk listener.
   * @param listener The chunk listener.
   */
  public onData(listener: (chunk: Uint8Array) => void): void {
    this.dataListener = listener;
  }

  /**
   * Registers the close listener, firing on the server process exiting.
   * @param listener The close listener.
   */
  public onClose(listener: (code: number | null, signal: string | null) => void): void {
    this.closeListener = listener;
  }

  /**
   * Destroys the socket and kills the server process (which ends every session it hosts).
   */
  public dispose(): void {
    if (this.socket !== null) {
      this.socket.destroy();
      this.socket = null;
    }
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
   * Connects the socket to the announced port and wires its data flow.
   * @param resolve The start resolver, called once connected.
   * @param reject The start rejecter, called on connection failure.
   */
  private connectSocket(resolve: () => void, reject: (reason: Error) => void): void {
    const socket: Socket = connect(this.listenPort, this.listenHost, (): void => resolve());
    socket.on('data', (chunk: Buffer): void => this.dataListener?.(chunk));
    socket.on('error', (error: Error): void => reject(error));
    this.socket = socket;
  }
}

/**
 * A DAP transport that connects a socket to an already-listening debug server, used to reach a js-debug
 * child target session on the same port its parent server session was reached on. It owns no process, so
 * disposing it only closes its socket; the server's lifetime belongs to the {@link TcpServerTransport}
 * that spawned it.
 */
export class TcpClientTransport implements DapTransport {
  /**
   * Holds the host to connect to.
   */
  private readonly host: string;

  /**
   * Holds the port to connect to.
   */
  private readonly port: number;

  /**
   * Holds the connected socket once started.
   */
  private socket: Socket | null = null;

  /**
   * Holds the inbound-chunk listener.
   */
  private dataListener: ((chunk: Uint8Array) => void) | null = null;

  /**
   * Holds the close listener.
   */
  private closeListener: ((code: number | null, signal: string | null) => void) | null = null;

  /**
   * Initializes a new instance of the {@link TcpClientTransport} class.
   * @param host The host to connect to.
   * @param port The port to connect to.
   */
  public constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
  }

  /**
   * Connects a socket to the server and wires its data flow.
   * @returns Returns a promise that resolves once connected.
   */
  public start(): Promise<void> {
    return new Promise<void>((resolve: () => void, reject: (reason: Error) => void): void => {
      const socket: Socket = connect(this.port, this.host, (): void => resolve());
      socket.on('data', (chunk: Buffer): void => this.dataListener?.(chunk));
      socket.on('error', (error: Error): void => reject(error));
      socket.on('close', (): void => this.closeListener?.(null, null));
      this.socket = socket;
    });
  }

  /**
   * Writes a framed message to the connected socket.
   * @param framed The framed message.
   */
  public send(framed: string): void {
    this.socket?.write(framed);
  }

  /**
   * Registers the inbound-chunk listener.
   * @param listener The chunk listener.
   */
  public onData(listener: (chunk: Uint8Array) => void): void {
    this.dataListener = listener;
  }

  /**
   * Registers the close listener, firing on the socket closing.
   * @param listener The close listener.
   */
  public onClose(listener: (code: number | null, signal: string | null) => void): void {
    this.closeListener = listener;
  }

  /**
   * Destroys the socket.
   */
  public dispose(): void {
    if (this.socket !== null) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}
