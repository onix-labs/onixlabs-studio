import { Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  NetworkToolsChannel,
  PingOutcome,
  PingReply,
  PingReplyEvent,
  PingRequest,
  TraceHop,
  TraceHopEvent,
  TraceOutcome,
  TraceRequest,
} from '@shared/api/network-tools-channels';

/**
 * The renderer client for the network tools the main process runs: ping and traceroute. Each run
 * streams its replies or hops to a callback and resolves how it ended. Outside Electron every run
 * fails at once, saying why.
 */
@Service()
export class NetworkToolsClient {
  /**
   * Holds the IPC transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Pings a host.
   * @param request The run.
   * @param onReply Receives each reply or timeout as it happens.
   * @returns Returns a promise resolving how the run ended.
   */
  public async ping(
    request: PingRequest,
    onReply: (reply: PingReply) => void,
  ): Promise<PingOutcome> {
    if (this.bridge === undefined) {
      return { kind: 'failed', message: 'Ping needs the desktop app.' };
    }
    const release: () => void = this.bridge.on(
      NetworkToolsChannel.PingReply,
      (...args: unknown[]): void => {
        const event: PingReplyEvent = args[0] as PingReplyEvent;
        if (event.id === request.id) {
          onReply(event.reply);
        }
      },
    );
    try {
      return await this.bridge.invoke<PingOutcome>(NetworkToolsChannel.Ping, request);
    } catch (error: unknown) {
      return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
    } finally {
      release();
    }
  }

  /**
   * Traces the route to a host.
   * @param request The run.
   * @param onHop Receives each hop as it is learned, and again as it grows.
   * @returns Returns a promise resolving how the run ended.
   */
  public async trace(request: TraceRequest, onHop: (hop: TraceHop) => void): Promise<TraceOutcome> {
    if (this.bridge === undefined) {
      return { kind: 'failed', message: 'Traceroute needs the desktop app.' };
    }
    const release: () => void = this.bridge.on(
      NetworkToolsChannel.TraceHop,
      (...args: unknown[]): void => {
        const event: TraceHopEvent = args[0] as TraceHopEvent;
        if (event.id === request.id) {
          onHop(event.hop);
        }
      },
    );
    try {
      return await this.bridge.invoke<TraceOutcome>(NetworkToolsChannel.Trace, request);
    } catch (error: unknown) {
      return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
    } finally {
      release();
    }
  }

  /**
   * Stops a run; its promise then resolves as cancelled.
   * @param id The run's id.
   */
  public cancel(id: string): void {
    this.bridge?.send(NetworkToolsChannel.Cancel, id);
  }
}
