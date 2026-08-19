import { MainContribution } from './main-contribution';
import { apiClientContribution } from './api-client/api-client.contribution';
import { dockerContribution } from './docker/docker.contribution';
import { modelRuntimeContribution } from './model-runtime/model-runtime.contribution';
import { systemMonitorContribution } from './system-monitor/system-monitor.contribution';

/**
 * The static, in-bundle manifest of main-process contributions the application activates at startup —
 * the backend analog of the renderer's `config.ts` provider list, and the extension point of this
 * seam. A backend is added by appending here, never by editing the application's construction logic:
 * the Docker Engine contribution below is registered by exactly this one line.
 *
 * When runtime discovery of third-party extensions lands (#295), the registry is constructed from this
 * manifest *plus* the discovered contributions — the same type, an extra source.
 */
export const mainContributions: readonly MainContribution[] = [
  apiClientContribution,
  dockerContribution,
  modelRuntimeContribution,
  systemMonitorContribution,
];
