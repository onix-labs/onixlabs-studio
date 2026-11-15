import {
  PingOutcome,
  PingReply,
  PingRequest,
  TraceHop,
  TraceOutcome,
  TraceRequest,
} from '@shared/api/network-tools-channels';

/**
 * A run the fake has been asked for, which a test drives to its end.
 */
export interface FakeToolRun {
  /**
   * Gets the request.
   */
  readonly request: PingRequest | TraceRequest;

  /**
   * Hands the run a reply, for a ping.
   */
  readonly reply: (reply: PingReply) => void;

  /**
   * Hands the run a hop, for a trace.
   */
  readonly hop: (hop: TraceHop) => void;

  /**
   * Ends the run.
   */
  readonly end: (outcome: PingOutcome | TraceOutcome) => void;
}

/**
 * A stand-in for the network tools: it runs nothing, records each run, and lets the test feed it
 * replies or hops and end it.
 */
export class FakeNetworkToolsClient {
  /**
   * Gets the runs asked for, in order.
   */
  public readonly started: FakeToolRun[] = [];

  /**
   * Gets the ids of the runs asked to stop.
   */
  public readonly cancelled: string[] = [];

  /**
   * Records a ping.
   * @param request The run.
   * @param onReply Receives replies.
   * @returns Returns a promise the test resolves through the run's `end`.
   */
  public ping(request: PingRequest, onReply: (reply: PingReply) => void): Promise<PingOutcome> {
    return new Promise<PingOutcome>((resolve: (outcome: PingOutcome) => void): void => {
      this.started.push({ request, reply: onReply, hop: (): void => undefined, end: resolve });
    });
  }

  /**
   * Records a trace.
   * @param request The run.
   * @param onHop Receives hops.
   * @returns Returns a promise the test resolves through the run's `end`.
   */
  public trace(request: TraceRequest, onHop: (hop: TraceHop) => void): Promise<TraceOutcome> {
    return new Promise<TraceOutcome>((resolve: (outcome: TraceOutcome) => void): void => {
      this.started.push({ request, reply: (): void => undefined, hop: onHop, end: resolve });
    });
  }

  /**
   * Records a stop, and ends the run as the main process would.
   * @param id The run's id.
   */
  public cancel(id: string): void {
    this.cancelled.push(id);
    this.started
      .filter((run: FakeToolRun): boolean => run.request.id === id)
      .forEach((run: FakeToolRun): void => run.end({ kind: 'cancelled' }));
  }
}
