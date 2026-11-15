import { inject, Service, Signal, signal, Type, WritableSignal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { DockFocus } from '@shared/angular/services/dock-layout/dock-focus';
import { StackNode } from '@shared/angular/services/dock-layout/dock-node';
import { DockPanelRegistry } from '@shared/angular/services/dock-layout/dock-panel-registry';
import { DockState } from '@shared/angular/services/dock-layout/dock-state';
import { firstStackOfRole } from '@shared/angular/services/dock-layout/dock-tree';
import { Log } from '@shared/angular/services/log/log';
import {
  NetworkToolOutcomeKind,
  PingOutcome,
  PingReply,
  TraceHop,
  TraceOutcome,
} from '@shared/api/network-tools-channels';
import { NetworkToolsClient } from '../network-tools-client/network-tools-client';
import { NETWORK_RUN_PANEL } from './network-run-panel';

/**
 * How many echo requests a ping sends.
 */
export const PING_COUNT: number = 10;

/**
 * The most hops a trace probes, as `traceroute` itself defaults to.
 */
export const TRACE_MAX_HOPS: number = 30;

/**
 * Where a run is: going, or ended in one of the ways a run ends.
 */
export type NetworkRunStatus = 'running' | NetworkToolOutcomeKind;

/**
 * What every run has, whatever it runs.
 */
interface NetworkRunBase {
  /**
   * Gets the run's id, which is also the id of its document in the well.
   */
  readonly id: string;

  /**
   * Gets the host the run is against, as the user gave it.
   */
  readonly host: string;

  /**
   * Gets where the run is.
   */
  readonly status: NetworkRunStatus;

  /**
   * Gets the address the host resolved to, once the tool has said.
   */
  readonly address?: string;

  /**
   * Gets why the run failed, fit to show.
   */
  readonly message?: string;
}

/**
 * A ping, and the replies it has had.
 */
export interface PingRun extends NetworkRunBase {
  /**
   * Discriminates a ping.
   */
  readonly kind: 'ping';

  /**
   * Gets the replies and timeouts, in the order they happened.
   */
  readonly replies: readonly PingReply[];
}

/**
 * A traced route, and the hops learned so far.
 */
export interface TraceRun extends NetworkRunBase {
  /**
   * Discriminates a trace.
   */
  readonly kind: 'trace';

  /**
   * Gets the hops, by number.
   */
  readonly hops: readonly TraceHop[];
}

/**
 * A ping or a traced route.
 */
export type NetworkRun = PingRun | TraceRun;

/**
 * The Network Explorer's ping and traceroute runs, each shown as a document in the well, shared by
 * every panel in one tab. Provided by the view, so a run outlives its document being set aside behind
 * another, and every run still going is stopped when the tab closes.
 *
 * Running the same tool against the same host again reuses its document rather than opening another,
 * the way opening a file that is already open does.
 */
@Service({ autoProvided: false })
export class NetworkRuns {
  /**
   * Holds the client that runs the tools.
   */
  private readonly client: NetworkToolsClient = inject(NetworkToolsClient);

  /**
   * Holds the dock's panel registry, which documents are registered with.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Holds the dock's layout, whose well documents are tabbed into.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the dock's focus, moved to a document as it opens.
   */
  private readonly dockFocus: DockFocus = inject(DockFocus);

  /**
   * Holds the component a run's document renders.
   */
  private readonly panel: Type<unknown> = inject(NETWORK_RUN_PANEL);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds every run, by id.
   */
  private readonly runsState: WritableSignal<ReadonlyMap<string, NetworkRun>> = signal<
    ReadonlyMap<string, NetworkRun>
  >(new Map<string, NetworkRun>());

  /**
   * Gets every run, by id.
   */
  public readonly runs: Signal<ReadonlyMap<string, NetworkRun>> = this.runsState.asReadonly();

  /**
   * Gets a run.
   * @param id The run's id.
   * @returns Returns the run, or undefined when there is none.
   */
  public run(id: string): NetworkRun | undefined {
    return this.runsState().get(id);
  }

  /**
   * Pings a host, in its own document.
   * @param host The host.
   * @returns Returns the run's id.
   */
  public ping(host: string): string {
    const id: string = this.reuseOrCreate('ping', host);
    this.open(id, `Ping ${host}`, Icon.NETWORK_PING);
    void this.runPing(id, host);
    return id;
  }

  /**
   * Traces the route to a host, in its own document.
   * @param host The host.
   * @returns Returns the run's id.
   */
  public trace(host: string): string {
    const id: string = this.reuseOrCreate('trace', host);
    this.open(id, `Route to ${host}`, Icon.NETWORK_ROUTE);
    void this.runTrace(id, host);
    return id;
  }

  /**
   * Runs a run again from the start, unless it is still going.
   * @param id The run's id.
   */
  public rerun(id: string): void {
    const run: NetworkRun | undefined = this.run(id);
    if (run === undefined || run.status === 'running') {
      return;
    }
    if (run.kind === 'ping') {
      void this.runPing(id, run.host);
    } else {
      void this.runTrace(id, run.host);
    }
  }

  /**
   * Stops a run that is still going.
   * @param id The run's id.
   */
  public stop(id: string): void {
    if (this.run(id)?.status === 'running') {
      this.client.cancel(id);
    }
  }

  /**
   * Stops every run still going, as the tab closes.
   */
  public stopAll(): void {
    for (const run of this.runsState().values()) {
      if (run.status === 'running') {
        this.client.cancel(run.id);
      }
    }
  }

  /**
   * Finds the run of a tool against a host that is not going, to run again in its document, or
   * names a new one.
   * @param kind The tool.
   * @param host The host.
   * @returns Returns the run's id.
   */
  private reuseOrCreate(kind: NetworkRun['kind'], host: string): string {
    for (const run of this.runsState().values()) {
      if (run.kind === kind && run.host === host && run.status !== 'running') {
        return run.id;
      }
    }
    return `network-${kind}-${crypto.randomUUID()}`;
  }

  /**
   * Opens a run's document in the well, or brings it forward when it is already there.
   * @param id The run's id.
   * @param title The document's title.
   * @param icon The document's icon.
   */
  private open(id: string, title: string, icon: Icon): void {
    const well: StackNode | null = firstStackOfRole(this.dockState.layout(), 'document');
    if (well === null) {
      this.log.warn('network-explorer.runs', 'No well to open a run in', { id });
      return;
    }
    if (this.registry.has(id)) {
      this.dockState.setActive(well.id, id);
    } else {
      this.registry.register({ id, title, icon, role: 'document', component: this.panel });
      this.dockState.tabInto(well.id, id);
    }
    this.dockFocus.focus(well.id);
  }

  /**
   * Runs a ping, keeping its run up to date as replies arrive.
   * @param id The run's id.
   * @param host The host.
   */
  private async runPing(id: string, host: string): Promise<void> {
    this.put({ kind: 'ping', id, host, status: 'running', replies: [] });
    this.log.info('network-explorer.runs', 'Ping started', { host });
    const outcome: PingOutcome = await this.client.ping(
      { id, host, count: PING_COUNT },
      (reply: PingReply): void =>
        this.patch(id, (run: NetworkRun): NetworkRun =>
          run.kind === 'ping' ? { ...run, replies: [...run.replies, reply] } : run,
        ),
    );
    // BSD `ping` prints nothing for a last request that goes unanswered; its closing statistics say
    // it was sent, so the requests never reported are the ones that timed out.
    if (outcome.transmitted !== undefined) {
      const sent: number = outcome.transmitted;
      this.patch(id, (run: NetworkRun): NetworkRun => {
        if (run.kind !== 'ping') {
          return run;
        }
        const reported: ReadonlySet<number> = new Set<number>(
          run.replies.map((reply: PingReply): number => reply.sequence),
        );
        const unreported: readonly PingReply[] = Array.from(
          { length: sent },
          (_: unknown, sequence: number): number => sequence,
        )
          .filter((sequence: number): boolean => !reported.has(sequence))
          .map((sequence: number): PingReply => ({ sequence }));
        return { ...run, replies: [...run.replies, ...unreported] };
      });
    }
    this.finish(id, outcome);
  }

  /**
   * Runs a trace, keeping its run up to date as hops are learned.
   * @param id The run's id.
   * @param host The host.
   */
  private async runTrace(id: string, host: string): Promise<void> {
    this.put({ kind: 'trace', id, host, status: 'running', hops: [] });
    this.log.info('network-explorer.runs', 'Trace started', { host });
    const outcome: TraceOutcome = await this.client.trace(
      { id, host, maxHops: TRACE_MAX_HOPS },
      (hop: TraceHop): void =>
        this.patch(id, (run: NetworkRun): NetworkRun =>
          run.kind === 'trace'
            ? {
                ...run,
                hops: [...run.hops.filter((known: TraceHop): boolean => known.index !== hop.index), hop]
                  .sort((a: TraceHop, b: TraceHop): number => a.index - b.index),
              }
            : run,
        ),
    );
    this.finish(id, outcome);
  }

  /**
   * Records how a run ended.
   * @param id The run's id.
   * @param outcome How it ended.
   */
  private finish(id: string, outcome: PingOutcome | TraceOutcome): void {
    this.patch(id, (run: NetworkRun): NetworkRun => ({
      ...run,
      status: outcome.kind,
      ...(outcome.address === undefined ? {} : { address: outcome.address }),
      ...(outcome.message === undefined ? {} : { message: outcome.message }),
    }));
    this.log.info('network-explorer.runs', 'Run ended', { id, outcome: outcome.kind });
  }

  /**
   * Stores a run, replacing any of the same id.
   * @param run The run.
   */
  private put(run: NetworkRun): void {
    this.runsState.update(
      (runs: ReadonlyMap<string, NetworkRun>): ReadonlyMap<string, NetworkRun> =>
        new Map<string, NetworkRun>(runs).set(run.id, run),
    );
  }

  /**
   * Changes a stored run.
   * @param id The run's id.
   * @param change Makes the changed run from the stored one.
   */
  private patch(id: string, change: (run: NetworkRun) => NetworkRun): void {
    const run: NetworkRun | undefined = this.run(id);
    if (run !== undefined) {
      this.put(change(run));
    }
  }
}
