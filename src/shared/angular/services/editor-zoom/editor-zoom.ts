import { Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Specifies the selectable editor zoom levels, as percentages, in ascending order.
 */
export const EDITOR_ZOOM_LEVELS: readonly number[] = [25, 50, 75, 100, 125, 150, 175, 200];

/**
 * Holds the default editor zoom level, as a percentage.
 */
const DEFAULT_ZOOM: number = 100;

/**
 * Holds the global editor zoom level applied to every code editor's font size.
 *
 * The zoom is a single percentage chosen from {@link EDITOR_ZOOM_LEVELS}; text editors scale their
 * font size by it and the well status strip both shows and sets it. It is global, so every editor
 * zooms together.
 */
@Service()
export class EditorZoom {
  /**
   * Holds the current zoom level, as a percentage.
   */
  private readonly level: WritableSignal<number> = signal<number>(DEFAULT_ZOOM);

  /**
   * Gets the current zoom level, as a percentage.
   */
  public readonly percent: Signal<number> = this.level.asReadonly();

  /**
   * Gets the selectable zoom levels, as percentages.
   */
  public readonly levels: readonly number[] = EDITOR_ZOOM_LEVELS;

  /**
   * Sets the zoom level, clamped to the selectable range.
   * @param percent The zoom level, as a percentage.
   */
  public set(percent: number): void {
    const min: number = EDITOR_ZOOM_LEVELS[0];
    const max: number = EDITOR_ZOOM_LEVELS[EDITOR_ZOOM_LEVELS.length - 1];
    this.level.set(Math.min(Math.max(percent, min), max));
  }
}
