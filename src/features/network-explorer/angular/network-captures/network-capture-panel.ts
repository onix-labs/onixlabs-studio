import { InjectionToken, Type } from '@angular/core';

/**
 * The component a capture's document in the well renders. Provided by the view rather than imported
 * by {@link NetworkCaptures}, because that component injects the captures it renders: naming it here
 * would make the two modules import each other.
 */
export const NETWORK_CAPTURE_PANEL: InjectionToken<Type<unknown>> = new InjectionToken<
  Type<unknown>
>('NETWORK_CAPTURE_PANEL');
