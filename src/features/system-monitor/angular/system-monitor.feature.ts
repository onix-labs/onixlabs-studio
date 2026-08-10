import { FeatureDescriptor } from '@shared/angular/services/feature-registry';
import { SystemMonitorRibbon } from './system-monitor-ribbon/system-monitor-ribbon';
import { SystemMonitorView } from './system-monitor-view/system-monitor-view';

/**
 * Describes the System Monitor feature's contribution to the application shell: a singleton,
 * Task-Manager-style tool view with a contextual ribbon. Unlike the pluggable features it is not
 * provider-backed — there is one implementation — but it is contributed through the same lazy
 * `featureContributions` seam (#388) for hygiene: it lands in its own code-split chunk and the shell
 * renders it without being compiled against it.
 *
 * This phase (epic #395 P2 / #397) ships the per-session log audit; the live metric tiles (CPU, Memory,
 * then Network/Disk/GPU) arrive in P3/P4. The ribbon carries the audit actions (refresh, clear filters,
 * copy); the stateful filters (session picker, severity, text) live in the view's own toolbar beside
 * the table.
 */
export const descriptor: FeatureDescriptor = {
  type: 'system-monitor',
  view: SystemMonitorView,
  ribbon: SystemMonitorRibbon,
};
