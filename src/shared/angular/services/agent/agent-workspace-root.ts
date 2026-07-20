import { InjectionToken } from '@angular/core';

/**
 * Resolves the workspace root an agent run should act within — its working directory — as an absolute
 * path, or null for none (the agent then runs against the user's home directory).
 *
 * Provided per host so a surface whose root is not the open folder workspace can override the default.
 * The repository (source-control) tab provides one returning its bound git repository's root; without
 * it, the agent would read the global {@link Workspace} root, which is null in a repository tab and so
 * falls back to home — leaving the agent looking in the wrong place. Hosts that do not provide the
 * token fall back to the global workspace root in the {@link Agent} service.
 */
export const AGENT_WORKSPACE_ROOT: InjectionToken<() => string | null> = new InjectionToken<
  () => string | null
>('AGENT_WORKSPACE_ROOT');
