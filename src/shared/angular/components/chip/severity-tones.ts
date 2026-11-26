import type { Severity } from '@shared/api/log-channels';
import type { ChipTone } from './chip';

/**
 * The chip tone each log severity is labelled in: trace quiet, then rising to danger for an error.
 * Shared by every log Studio shows — the System Monitor's and a workspace's Logs panel — so a level
 * reads the same wherever it appears.
 */
export const SEVERITY_TONES: Readonly<Record<Severity, ChipTone>> = {
  trace: 'neutral',
  debug: 'info',
  info: 'accent',
  warning: 'warning',
  error: 'danger',
};
