import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { Chip, ChipTone } from '@shared/angular/components/chip/chip';
import { Button } from '@shared/angular/components/forms/button/button';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { PingReply, TraceHop, TraceProbe } from '@shared/api/network-tools-channels';
import {
  NetworkRun,
  NetworkRunStatus,
  NetworkRuns,
  PING_COUNT,
} from '../../network-runs/network-runs';

/**
 * Describes a ping's replies taken together.
 */
interface PingSummary {
  /**
   * Gets how many echo requests have been sent.
   */
  readonly sent: number;

  /**
   * Gets how many were answered.
   */
  readonly received: number;

  /**
   * Gets the share unanswered, as a whole percentage.
   */
  readonly lossPercent: number;

  /**
   * Gets the fastest, mean and slowest round trips in milliseconds, or undefined before any answer.
   */
  readonly rtt?: { readonly min: number; readonly avg: number; readonly max: number };
}

/**
 * Describes one hop as the route table shows it.
 */
interface HopRow {
  /**
   * Gets the hop.
   */
  readonly hop: TraceHop;

  /**
   * Gets the distinct addresses that answered, in the order they first did.
   */
  readonly addresses: readonly string[];

  /**
   * Gets each probe's result: its round trip and any annotation, or `*` when nothing answered.
   */
  readonly times: readonly string[];
}

/**
 * Formats a round trip.
 * @param ms The round trip in milliseconds.
 * @returns Returns it to a precision that suits its size.
 */
function formatMs(ms: number): string {
  return `${ms < 10 ? ms.toFixed(2) : ms.toFixed(1)} ms`;
}

/**
 * A ping or a traced route, as a document in the Network Explorer's well: what it is against, where
 * it is, and what it has found so far — each reply, or each hop with whoever answered it and how
 * fast. The run itself lives in {@link NetworkRuns}, so this document can be set aside behind
 * another and come back to a run that carried on without it.
 */
@Component({
  selector: 'app-run-panel',
  imports: [AppIcon, Button, Chip, PanelToolbar],
  templateUrl: './run-panel.html',
  styleUrl: './run-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunPanel {
  /**
   * Gets the dock panel this component is projected into, whose id is the run's.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the tab's runs.
   */
  private readonly runs: NetworkRuns = inject(NetworkRuns);

  /**
   * Holds the icon tokens used by the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Formats a round trip for the template.
   */
  protected readonly formatMs: (ms: number) => string = formatMs;

  /**
   * Gets the run, or undefined when it is gone.
   */
  protected readonly run: Signal<NetworkRun | undefined> = computed(
    (): NetworkRun | undefined => this.runs.runs().get(this.panel().id),
  );

  /**
   * Gets the run's heading.
   */
  protected readonly heading: Signal<string> = computed((): string => {
    const run: NetworkRun | undefined = this.run();
    if (run === undefined) {
      return '';
    }
    return run.kind === 'ping' ? `Ping ${run.host}` : `Route to ${run.host}`;
  });

  /**
   * Gets the ping's replies, newest last, or none for a trace.
   */
  protected readonly replies: Signal<readonly PingReply[]> = computed(
    (): readonly PingReply[] => {
      const run: NetworkRun | undefined = this.run();
      return run?.kind === 'ping' ? run.replies : [];
    },
  );

  /**
   * Gets the ping's replies taken together.
   */
  protected readonly pingSummary: Signal<PingSummary> = computed((): PingSummary => {
    const replies: readonly PingReply[] = this.replies();
    const times: readonly number[] = replies
      .map((reply: PingReply): number | undefined => reply.rttMs)
      .filter((ms: number | undefined): ms is number => ms !== undefined);
    const sent: number = replies.length;
    return {
      sent,
      received: times.length,
      lossPercent: sent === 0 ? 0 : Math.round(((sent - times.length) / sent) * 100),
      ...(times.length === 0
        ? {}
        : {
            rtt: {
              min: Math.min(...times),
              avg: times.reduce((sum: number, ms: number): number => sum + ms, 0) / times.length,
              max: Math.max(...times),
            },
          }),
    };
  });

  /**
   * Gets how many echo requests a ping sends, for its progress.
   */
  protected readonly pingCount: number = PING_COUNT;

  /**
   * Gets the route's hops as the table shows them, or none for a ping.
   */
  protected readonly hops: Signal<readonly HopRow[]> = computed((): readonly HopRow[] => {
    const run: NetworkRun | undefined = this.run();
    if (run?.kind !== 'trace') {
      return [];
    }
    return run.hops.map(
      (hop: TraceHop): HopRow => ({
        hop,
        addresses: [
          ...new Set<string>(
            hop.probes
              .map((probe: TraceProbe): string | undefined => probe.address)
              .filter((address: string | undefined): address is string => address !== undefined),
          ),
        ],
        times: hop.probes.map((probe: TraceProbe): string =>
          probe.rttMs === undefined
            ? '*'
            : `${formatMs(probe.rttMs)}${probe.note === undefined ? '' : ` ${probe.note}`}`,
        ),
      }),
    );
  });

  /**
   * Gets the tone the run's status is shown in.
   * @param status The status.
   * @returns Returns the tone.
   */
  protected toneOf(status: NetworkRunStatus): ChipTone {
    switch (status) {
      case 'running':
        return 'info';
      case 'completed':
        return 'success';
      case 'failed':
        return 'danger';
      case 'cancelled':
        return 'neutral';
    }
  }

  /**
   * Gets the words the run's status is shown as.
   * @param status The status.
   * @returns Returns the label.
   */
  protected labelOf(status: NetworkRunStatus): string {
    switch (status) {
      case 'running':
        return 'Running';
      case 'completed':
        return 'Done';
      case 'failed':
        return 'Failed';
      case 'cancelled':
        return 'Stopped';
    }
  }

  /**
   * Stops the run.
   */
  protected stop(): void {
    this.runs.stop(this.panel().id);
  }

  /**
   * Runs the run again from the start.
   */
  protected rerun(): void {
    this.runs.rerun(this.panel().id);
  }
}
