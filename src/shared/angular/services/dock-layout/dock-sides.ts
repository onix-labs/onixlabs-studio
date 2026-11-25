import { DockSide } from './dock-node';

/**
 * The sides of the main group a panel may dock to (#1575). Flags: combine them with `|`.
 */
export enum DockSides {
  None = 0,
  Top = 1,
  Bottom = 2,
  Left = 4,
  Right = 8,
  Vertical = Top | Bottom,
  Horizontal = Left | Right,
  All = Vertical | Horizontal,
}

/**
 * The flag of each side.
 */
const FLAGS: Readonly<Record<DockSide, DockSides>> = {
  top: DockSides.Top,
  bottom: DockSides.Bottom,
  left: DockSides.Left,
  right: DockSides.Right,
};

/**
 * Determines whether a side is one of those allowed.
 * @param sides The sides allowed.
 * @param side The side.
 * @returns Returns true when it is.
 */
export function allowsSide(sides: DockSides, side: DockSide): boolean {
  return (sides & FLAGS[side]) !== 0;
}
