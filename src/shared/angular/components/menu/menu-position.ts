import { ConnectedPosition } from '@angular/cdk/overlay';

/**
 * Specifies where a drop menu opens relative to its trigger: below or above, aligned to the trigger's
 * start or end edge.
 */
export type MenuPlacement = 'down-start' | 'down-end' | 'up-start' | 'up-end';

/**
 * Maps each {@link MenuPlacement} to the CDK overlay position that realises it, so every menu trigger
 * shares one definition instead of repeating the position literal.
 */
export const MENU_POSITIONS: Readonly<Record<MenuPlacement, readonly ConnectedPosition[]>> = {
  'down-start': [{ originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top' }],
  'down-end': [{ originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top' }],
  'up-start': [{ originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom' }],
  'up-end': [{ originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom' }],
};
