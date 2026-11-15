import { InjectionToken, Type } from '@angular/core';

/**
 * The component a run's document in the well renders. Provided by the view rather than imported by
 * {@link NetworkRuns}, because that component injects the runs it renders: naming it here would make
 * the two modules import each other.
 */
export const NETWORK_RUN_PANEL: InjectionToken<Type<unknown>> = new InjectionToken<Type<unknown>>(
  'NETWORK_RUN_PANEL',
);
