/**
 * The IPC contract for the network tools the Network Explorer runs against a host: ping and
 * traceroute. Both are the operating system's own tools, run by the main process — they need raw or
 * ICMP sockets, which the renderer cannot open — with their output parsed into the shapes below and
 * streamed back a reply or a hop at a time.
 *
 * A run is named by an id the renderer chooses, so the streamed events and a cancel can name it.
 */
export enum NetworkToolsChannel {
  /**
   * Renderer → main (invoke): pings a host, a {@link PingRequest}; streams {@link PingReplyEvent}s on
   * {@link PingReply} and resolves a {@link PingOutcome} once the run ends.
   */
  Ping = 'network-tools:ping',

  /**
   * Main → renderer (send): one reply, or one timeout, of a running ping, a {@link PingReplyEvent}.
   */
  PingReply = 'network-tools:ping-reply',

  /**
   * Renderer → main (invoke): traces the route to a host, a {@link TraceRequest}; streams
   * {@link TraceHopEvent}s on {@link TraceHop} and resolves a {@link TraceOutcome} once the run ends.
   */
  Trace = 'network-tools:trace',

  /**
   * Main → renderer (send): one hop of a running trace as it is now known, a {@link TraceHopEvent}. A
   * hop is sent again when a further line of output adds to it.
   */
  TraceHop = 'network-tools:trace-hop',

  /**
   * Renderer → main (send): stops a run, by its id. Its invoke resolves as cancelled.
   */
  Cancel = 'network-tools:cancel',
}

/**
 * The most echo requests one ping may send.
 */
export const MAX_PING_COUNT: number = 100;

/**
 * The most hops one trace may probe.
 */
export const MAX_TRACE_HOPS: number = 64;

/**
 * Asks for a host to be pinged.
 */
export interface PingRequest {
  /**
   * Gets the run's id, chosen by the renderer.
   */
  readonly id: string;

  /**
   * Gets the host: an IPv4 or IPv6 address, or a host name.
   */
  readonly host: string;

  /**
   * Gets how many echo requests to send, up to {@link MAX_PING_COUNT}.
   */
  readonly count: number;
}

/**
 * Describes one echo request's fate.
 */
export interface PingReply {
  /**
   * Gets the request's sequence number.
   */
  readonly sequence: number;

  /**
   * Gets the address that replied, or undefined when nothing did.
   */
  readonly address?: string;

  /**
   * Gets the reply's time to live (IPv4) or hop limit (IPv6).
   */
  readonly ttl?: number;

  /**
   * Gets the round trip in milliseconds, or undefined when the request timed out.
   */
  readonly rttMs?: number;
}

/**
 * Carries one reply of a running ping to the renderer.
 */
export interface PingReplyEvent {
  /**
   * Gets the run's id.
   */
  readonly id: string;

  /**
   * Gets the reply.
   */
  readonly reply: PingReply;
}

/**
 * How a run ended: it ran to its end, it could not run or failed part-way, or it was stopped.
 */
export type NetworkToolOutcomeKind = 'completed' | 'failed' | 'cancelled';

/**
 * Describes how a ping ended.
 */
export interface PingOutcome {
  /**
   * Gets how the run ended.
   */
  readonly kind: NetworkToolOutcomeKind;

  /**
   * Gets the address the host resolved to, when the tool said.
   */
  readonly address?: string;

  /**
   * Gets how many echo requests the tool says it sent, from its closing statistics. BSD `ping`
   * reports no timeout for the last request, so this is what tells how many there were.
   */
  readonly transmitted?: number;

  /**
   * Gets why the run failed, fit to show.
   */
  readonly message?: string;
}

/**
 * Asks for the route to a host to be traced.
 */
export interface TraceRequest {
  /**
   * Gets the run's id, chosen by the renderer.
   */
  readonly id: string;

  /**
   * Gets the host: an IPv4 or IPv6 address, or a host name.
   */
  readonly host: string;

  /**
   * Gets the most hops to probe, up to {@link MAX_TRACE_HOPS}.
   */
  readonly maxHops: number;
}

/**
 * Describes one probe sent to a hop.
 */
export interface TraceProbe {
  /**
   * Gets the address that answered, or undefined when nothing did.
   */
  readonly address?: string;

  /**
   * Gets the round trip in milliseconds, or undefined when nothing answered.
   */
  readonly rttMs?: number;

  /**
   * Gets the tool's annotation of the answer — `!H` (host unreachable), `!N` (network unreachable) and
   * the like — when it made one.
   */
  readonly note?: string;
}

/**
 * Describes one hop of a route: the probes sent with its time to live, and who answered them. A hop
 * whose probes went to different routers (a load-balanced path) lists each.
 */
export interface TraceHop {
  /**
   * Gets the hop's number, from 1.
   */
  readonly index: number;

  /**
   * Gets the probes, in the order they were sent.
   */
  readonly probes: readonly TraceProbe[];
}

/**
 * Carries one hop of a running trace to the renderer.
 */
export interface TraceHopEvent {
  /**
   * Gets the run's id.
   */
  readonly id: string;

  /**
   * Gets the hop as it is now known.
   */
  readonly hop: TraceHop;
}

/**
 * Describes how a trace ended.
 */
export interface TraceOutcome {
  /**
   * Gets how the run ended.
   */
  readonly kind: NetworkToolOutcomeKind;

  /**
   * Gets the address the host resolved to, when the tool said.
   */
  readonly address?: string;

  /**
   * Gets why the run failed, fit to show.
   */
  readonly message?: string;
}
