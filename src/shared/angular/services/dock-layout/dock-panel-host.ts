import { InjectionToken } from '@angular/core';

/**
 * Provided to a dock panel's content, whose group already draws its title and buttons, so content that
 * would draw a header of its own elsewhere does not (#1569).
 */
export const DOCK_PANEL_HOST: InjectionToken<boolean> = new InjectionToken<boolean>(
  'DOCK_PANEL_HOST',
);
