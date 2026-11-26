import { DockBlueprint } from './dock-blueprint';

/**
 * What every simple dock's blueprint has in common: how it looks, the buttons its title bars show, and the
 * half of its space its main group keeps (#1575).
 */
export const SIMPLE_DOCK: Pick<DockBlueprint, 'appearance' | 'buttons' | 'mainShare'> = {
  appearance: 'simple',
  buttons: ['auto-hide', 'close'],
  mainShare: 0.5,
};
