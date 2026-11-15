/**
 * Describes the machine's health at a glance: whether anything is under pressure, and what.
 */
export interface MachineHealth {
  /**
   * Gets whether the machine is healthy.
   */
  readonly healthy: boolean;

  /**
   * Gets the verdict in a word or two (`Healthy`, `Memory pressure`).
   */
  readonly label: string;

  /**
   * Gets every pressure found, for the verdict's tooltip; empty when healthy.
   */
  readonly reasons: readonly string[];
}
