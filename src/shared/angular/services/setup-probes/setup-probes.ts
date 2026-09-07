import { computed, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  GitIdentity,
  SetupChannel,
  SetupProbeResult,
  SetupProbeStatus,
} from '@shared/api/setup-channels';
import { Log } from '@shared/angular/services/log/log';

/**
 * Renderer-side view of what the main process found on this machine, for the setup wizard's
 * environment step.
 *
 * Outside Electron there is no bridge and therefore nothing to probe; the list stays empty and the
 * step reports that it could not look, rather than reporting that nothing is installed.
 */
@Service()
export class SetupProbes {
  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the latest results.
   */
  private readonly latest: WritableSignal<readonly SetupProbeResult[]> = signal<
    readonly SetupProbeResult[]
  >([]);

  /**
   * Holds whether a probe run is in flight.
   */
  private readonly running: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether a run has ever completed, which is what tells "nothing found" apart from "not yet
   * looked" — the two look identical in an empty list and mean opposite things.
   */
  private readonly probed: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the latest results.
   */
  public readonly results: Signal<readonly SetupProbeResult[]> = this.latest.asReadonly();

  /**
   * Gets whether a probe run is in flight.
   */
  public readonly busy: Signal<boolean> = this.running.asReadonly();

  /**
   * Gets whether a run has completed at least once.
   */
  public readonly hasProbed: Signal<boolean> = this.probed.asReadonly();

  /**
   * Gets whether the environment can be probed at all.
   */
  public readonly isAvailable: boolean = this.bridge !== undefined;

  /**
   * Gets the results that need the user's attention, which is what decides whether the step has
   * anything to say. A probe that could not be run is included: "could not check" is a finding.
   */
  public readonly problems: Signal<readonly SetupProbeResult[]> = computed(
    (): readonly SetupProbeResult[] =>
      this.latest().filter((result: SetupProbeResult): boolean => result.status !== 'ok'),
  );

  /**
   * Runs every probe, replacing the previous results.
   * @returns Returns a promise that resolves once the run settles.
   */
  public async refresh(): Promise<void> {
    if (this.bridge === undefined) {
      return;
    }
    this.running.set(true);
    try {
      const results: readonly SetupProbeResult[] =
        (await this.bridge.invoke<readonly SetupProbeResult[]>(SetupChannel.Probe)) ?? [];
      this.latest.set(results);
      this.probed.set(true);
    } catch (error: unknown) {
      // A failed run must not leave stale results looking current.
      this.log.error('SetupProbes', 'Probe run failed', error);
      this.latest.set([]);
      this.probed.set(true);
    } finally {
      this.running.set(false);
    }
  }

  /**
   * Reads the globally configured git identity.
   * @returns Returns the identity, or null when it could not be read.
   */
  public async gitIdentity(): Promise<GitIdentity | null> {
    return (await this.bridge?.invoke<GitIdentity | null>(SetupChannel.GetGitIdentity)) ?? null;
  }

  /**
   * Writes the globally configured git identity and re-probes, so the step reflects the change it
   * just made rather than the state it was opened in.
   * @param identity The identity to write.
   * @returns Returns the identity git holds afterwards, or null when it could not be written.
   */
  public async setGitIdentity(identity: GitIdentity): Promise<GitIdentity | null> {
    const written: GitIdentity | null =
      (await this.bridge?.invoke<GitIdentity | null>(SetupChannel.SetGitIdentity, identity)) ??
      null;
    await this.refresh();
    return written;
  }

  /**
   * Returns the status of a single probe, or `unknown` when it has not been run.
   * @param id The probe identifier.
   * @returns Returns the status.
   */
  public statusOf(id: string): SetupProbeStatus {
    return (
      this.latest().find((result: SetupProbeResult): boolean => result.id === id)?.status ??
      'unknown'
    );
  }
}
