/**
 * How one plugin fared in the install gate.
 *
 * `skipped` is never silent: it always carries the reason, and the run's summary prints it.
 */
export type GatePluginOutcome = 'pass' | 'fail' | 'skipped';

/**
 * One plugin's line in the gate's summary.
 */
export interface GatePluginResult {
  /**
   * Gets the plugin's identifier.
   */
  readonly id: string;

  /**
   * Gets the name the wizard lists it under.
   */
  readonly name: string;

  /**
   * Gets the wizard step it was offered on.
   */
  readonly step: string;

  /**
   * Gets how it fared.
   */
  readonly outcome: GatePluginOutcome;

  /**
   * Gets why it failed or was skipped, or undefined when it passed.
   */
  readonly reason?: string;

  /**
   * Gets how long its install took, in seconds.
   */
  readonly seconds: number;
}
