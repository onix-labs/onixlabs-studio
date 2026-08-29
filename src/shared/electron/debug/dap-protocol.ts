import type { DebugProtocol } from '@vscode/debugprotocol';
import { logger } from '../logger';

/**
 * The Debug Adapter Protocol message framing and request/response correlation, kept free of any Node or
 * DOM dependency so it can be unit-tested in isolation and reused by the Node-side {@link
 * import('./dap-client').DapClient} shell.
 *
 * DAP shares the Language Server Protocol's `Content-Length` header framing over a byte stream, but its
 * message envelope is **not** JSON-RPC: every message carries its own `seq`, and a response references
 * the request it answers by `request_seq` (rather than a JSON-RPC `id`). This module therefore mirrors
 * the LSP transport's framing while implementing DAP's own sequencing, so the client can spawn an
 * adapter over the same stdio pattern the LSP manager uses without pretending DAP is JSON-RPC.
 */

/**
 * The bytes of the `\r\n\r\n` sequence that separates a DAP message's header block from its JSON body.
 */
const HEADER_TERMINATOR: readonly number[] = [13, 10, 13, 10];

/**
 * The header naming the byte length of the JSON body that follows, matched case-insensitively.
 */
const CONTENT_LENGTH_HEADER: string = 'content-length';

/**
 * Encodes a DAP message for the wire: a `Content-Length` header (counting the body's UTF-8 **bytes**,
 * not its characters) followed by the JSON body.
 * @param message The message to encode.
 * @returns Returns the framed message text ready to write to the adapter's standard input.
 */
export function encodeMessage(message: DebugProtocol.ProtocolMessage): string {
  const body: string = JSON.stringify(message);
  const length: number = new TextEncoder().encode(body).length;
  return `Content-Length: ${length}\r\n\r\n${body}`;
}

/**
 * Reassembles whole DAP messages from the arbitrary byte chunks a stream delivers. Buffering is
 * byte-based so a `Content-Length` (a byte count) is honoured exactly even when a multi-byte UTF-8
 * character straddles two chunks, which a character-based buffer would miscount.
 */
export class DapMessageDecoder {
  /**
   * Holds the bytes received but not yet consumed as a complete message.
   */
  private buffer: Uint8Array = new Uint8Array(0);

  /**
   * Decodes the JSON body once its bytes are in hand. Typed through the constructor so the annotation
   * holds under both the Node and DOM standard libraries (`TextDecoder` is a global value in each).
   */
  private readonly decoder: InstanceType<typeof TextDecoder> = new TextDecoder('utf-8');

  /**
   * Appends a received chunk and returns every complete message it now makes available, in order. A
   * chunk that completes no message returns an empty array; a chunk that completes several returns them
   * all.
   * @param chunk The received bytes.
   * @returns Returns the newly completed messages.
   */
  public append(chunk: Uint8Array): DebugProtocol.ProtocolMessage[] {
    this.buffer = concat(this.buffer, chunk);
    const messages: DebugProtocol.ProtocolMessage[] = [];
    for (let message: DebugProtocol.ProtocolMessage | null = this.take(); message !== null;) {
      messages.push(message);
      message = this.take();
    }
    return messages;
  }

  /**
   * Takes the next complete message from the buffer, consuming its bytes, or returns null when the
   * buffer does not yet hold a whole message (its header, or its declared body, is still incoming).
   * @returns Returns the next message, or null when none is complete.
   */
  private take(): DebugProtocol.ProtocolMessage | null {
    const headerEnd: number = indexOf(this.buffer, HEADER_TERMINATOR);
    if (headerEnd === -1) {
      return null;
    }
    const header: string = this.decoder.decode(this.buffer.subarray(0, headerEnd));
    const length: number | null = contentLength(header);
    const bodyStart: number = headerEnd + HEADER_TERMINATOR.length;
    if (length === null) {
      // A header block without a usable Content-Length cannot be interpreted; drop it so a single
      // malformed frame cannot wedge the stream, and resume from the byte after it.
      logger.warn('DapProtocol', 'Dropped a DAP frame with no usable Content-Length header');
      this.buffer = this.buffer.subarray(bodyStart);
      return null;
    }
    if (this.buffer.length - bodyStart < length) {
      return null;
    }
    const body: string = this.decoder.decode(this.buffer.subarray(bodyStart, bodyStart + length));
    this.buffer = this.buffer.subarray(bodyStart + length);
    try {
      return JSON.parse(body) as DebugProtocol.ProtocolMessage;
    } catch (error: unknown) {
      // A frame whose body is not valid JSON is dropped; its bytes are already consumed, so decoding
      // continues cleanly with the next frame.
      logger.error('DapProtocol', 'Dropped a DAP frame with an unparseable JSON body', error);
      return null;
    }
  }
}

/**
 * Correlates the DAP messages flowing to and from an adapter: it stamps each outgoing message with the
 * next sequence number, resolves a sent request when its response arrives (rejecting on a failed
 * response), and delivers the adapter's events and reverse requests to listeners. It knows nothing of
 * the transport — outgoing messages are handed to a sink supplied by the caller — so it can be driven
 * entirely in memory.
 */
export class DapProtocol {
  /**
   * Sends an encoded message towards the adapter.
   */
  private readonly sink: (message: DebugProtocol.ProtocolMessage) => void;

  /**
   * Holds the next sequence number to stamp on an outgoing message; DAP sequence numbers start at one.
   */
  private sequence: number = 1;

  /**
   * Holds the in-flight requests awaiting a response, keyed by the sequence number they were sent with.
   */
  private readonly pending: Map<number, PendingRequest> = new Map<number, PendingRequest>();

  /**
   * Holds the registered adapter-event listeners.
   */
  private readonly eventListeners: Set<(event: DebugProtocol.Event) => void> = new Set<
    (event: DebugProtocol.Event) => void
  >();

  /**
   * Holds the registered reverse-request listeners (requests the adapter makes of the client, such as
   * `runInTerminal`).
   */
  private readonly requestListeners: Set<(request: DebugProtocol.Request) => void> = new Set<
    (request: DebugProtocol.Request) => void
  >();

  /**
   * Initializes a new instance of the {@link DapProtocol} class.
   * @param sink The callback that transmits an outgoing message to the adapter.
   */
  public constructor(sink: (message: DebugProtocol.ProtocolMessage) => void) {
    this.sink = sink;
  }

  /**
   * Sends a request to the adapter and resolves with its response body when the adapter reports
   * success, or rejects with the adapter's message when it reports failure.
   * @param command The DAP request command (for example `initialize` or `launch`).
   * @param args The request arguments, or undefined when the command takes none.
   * @returns Returns the response body, typed by the caller.
   */
  public sendRequest<T = unknown>(command: string, args?: unknown): Promise<T> {
    const seq: number = this.sequence++;
    const request: DebugProtocol.Request = { seq, type: 'request', command, arguments: args };
    return new Promise<T>((resolve: (value: T) => void, reject: (reason: Error) => void): void => {
      this.pending.set(seq, {
        resolve: (body: unknown): void => resolve(body as T),
        reject,
        command,
      });
      this.sink(request);
    });
  }

  /**
   * Routes a message received from the adapter: resolving or rejecting the matching pending request for
   * a response, or dispatching an event or reverse request to its listeners.
   * @param message The received message.
   */
  public handleMessage(message: DebugProtocol.ProtocolMessage): void {
    if (message.type === 'response') {
      this.handleResponse(message as DebugProtocol.Response);
    } else if (message.type === 'event') {
      const event: DebugProtocol.Event = message as DebugProtocol.Event;
      for (const listener of this.eventListeners) {
        listener(event);
      }
    } else if (message.type === 'request') {
      const request: DebugProtocol.Request = message as DebugProtocol.Request;
      for (const listener of this.requestListeners) {
        listener(request);
      }
    }
  }

  /**
   * Registers a listener for adapter events (such as `stopped`, `output`, or `terminated`).
   * @param listener The listener to add.
   * @returns Returns a disposer that removes the listener.
   */
  public onEvent(listener: (event: DebugProtocol.Event) => void): () => void {
    this.eventListeners.add(listener);
    return (): void => {
      this.eventListeners.delete(listener);
    };
  }

  /**
   * Registers a listener for reverse requests the adapter makes of the client.
   * @param listener The listener to add.
   * @returns Returns a disposer that removes the listener.
   */
  public onReverseRequest(listener: (request: DebugProtocol.Request) => void): () => void {
    this.requestListeners.add(listener);
    return (): void => {
      this.requestListeners.delete(listener);
    };
  }

  /**
   * Sends a response to a reverse request the adapter made of the client.
   * @param request The reverse request being answered.
   * @param body The response body, or undefined when the command returns none.
   * @param success Whether the client handled the request; defaults to true.
   */
  public respondTo(request: DebugProtocol.Request, body?: unknown, success: boolean = true): void {
    const response: DebugProtocol.Response = {
      seq: this.sequence++,
      type: 'response',
      request_seq: request.seq,
      success,
      command: request.command,
      body,
    };
    this.sink(response);
  }

  /**
   * Rejects every in-flight request, used when the adapter's connection is torn down so no caller is
   * left awaiting a response that can never arrive.
   * @param reason The reason to reject pending requests with.
   */
  public dispose(reason: string): void {
    for (const request of this.pending.values()) {
      request.reject(new Error(reason));
    }
    this.pending.clear();
    this.eventListeners.clear();
    this.requestListeners.clear();
  }

  /**
   * Resolves or rejects the request a response answers, ignoring a response whose `request_seq` matches
   * nothing pending (a duplicate or an answer to a request that already settled).
   * @param response The received response.
   */
  private handleResponse(response: DebugProtocol.Response): void {
    const request: PendingRequest | undefined = this.pending.get(response.request_seq);
    if (request === undefined) {
      logger.trace(
        'DapProtocol',
        `Ignored a response with no matching request (seq=${response.request_seq})`,
      );
      return;
    }
    this.pending.delete(response.request_seq);
    if (response.success) {
      request.resolve(response.body);
    } else {
      logger.warn('DapProtocol', `Adapter reported a failed response for ${request.command}`);
      request.reject(new Error(response.message ?? `${request.command} failed`));
    }
  }
}

/**
 * Holds a request awaiting its response.
 */
interface PendingRequest {
  /**
   * Resolves the request with the response body.
   */
  readonly resolve: (body: unknown) => void;

  /**
   * Rejects the request with an error.
   */
  readonly reject: (reason: Error) => void;

  /**
   * Holds the request command, used to phrase a failure when the adapter supplies no message.
   */
  readonly command: string;
}

/**
 * Parses the `Content-Length` value from a DAP header block, tolerating the header's letter case and
 * surrounding whitespace, and returns null when it is absent or not a non-negative integer.
 * @param header The decoded header block (without the terminating blank line).
 * @returns Returns the declared body length in bytes, or null when unusable.
 */
function contentLength(header: string): number | null {
  for (const line of header.split(/\r\n/)) {
    const separator: number = line.indexOf(':');
    if (separator === -1) {
      continue;
    }
    if (line.slice(0, separator).trim().toLowerCase() !== CONTENT_LENGTH_HEADER) {
      continue;
    }
    const value: string = line.slice(separator + 1).trim();
    if (!/^\d+$/.test(value)) {
      return null;
    }
    return Number.parseInt(value, 10);
  }
  return null;
}

/**
 * Finds the first index at which a byte sequence occurs within a buffer.
 * @param buffer The buffer to search.
 * @param needle The byte sequence to find.
 * @returns Returns the start index of the first occurrence, or -1 when absent.
 */
function indexOf(buffer: Uint8Array, needle: readonly number[]): number {
  outer: for (let i: number = 0; i + needle.length <= buffer.length; i++) {
    for (let j: number = 0; j < needle.length; j++) {
      if (buffer[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}

/**
 * Concatenates two byte buffers into a new buffer.
 * @param left The first buffer.
 * @param right The second buffer.
 * @returns Returns the combined buffer.
 */
function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const combined: Uint8Array = new Uint8Array(left.length + right.length);
  combined.set(left, 0);
  combined.set(right, left.length);
  return combined;
}
