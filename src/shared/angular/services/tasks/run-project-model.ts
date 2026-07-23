import { InjectionToken, Signal } from '@angular/core';
import { ProjectModel } from '@shared/api/project-system';

/**
 * Provides the owning workspace's project model to the build runner, so a run configuration's
 * provider-default command can resolve real targets (for example a .NET project's file path from its
 * name) instead of trusting the configuration id verbatim. Provided by the workspace view (whose
 * feature owns the solution model — the shared runner must not depend on feature code); absent, the
 * runner falls back to the literal target.
 */
export const RUN_PROJECT_MODEL: InjectionToken<Signal<ProjectModel | null>> = new InjectionToken<
  Signal<ProjectModel | null>
>('RUN_PROJECT_MODEL');
