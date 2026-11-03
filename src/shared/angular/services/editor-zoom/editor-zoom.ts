import { inject, Service, Signal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';

/**
 * Specifies the selectable editor zoom levels, as percentages, in ascending order.
 */
export const EDITOR_ZOOM_LEVELS: readonly number[] = [25, 50, 75, 100, 125, 150, 175, 200];

/**
 * Holds the global editor zoom level applied to every code editor's font size.
 *
 * The zoom is a single percentage chosen from {@link EDITOR_ZOOM_LEVELS}; text editors scale their
 * font size by it and the well status strip both shows and sets it. It is global, so every editor
 * zooms together, and remembered, so it survives a relaunch.
 */
@Service()
export class EditorZoom {
  /**
   * Holds the settings the zoom level is remembered in.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets the current zoom level, as a percentage.
   */
  public readonly percent: Signal<number> = this.settings.value('textEditor.zoom');

  /**
   * Gets the selectable zoom levels, as percentages.
   */
  public readonly levels: readonly number[] = EDITOR_ZOOM_LEVELS;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Sets the zoom level, clamped to the selectable range.
   * @param percent The zoom level, as a percentage.
   */
  public set(percent: number): void {
    const min: number = EDITOR_ZOOM_LEVELS[0];
    const max: number = EDITOR_ZOOM_LEVELS[EDITOR_ZOOM_LEVELS.length - 1];
    const clamped: number = Math.min(Math.max(percent, min), max);
    this.settings.set('textEditor.zoom', clamped);
    this.log.debug('EditorZoom', `Zoom set to ${clamped}%`);
  }

  /**
   * Moves the zoom one selectable level in or out, staying put at either end.
   * @param direction Which way to move: above zero zooms in, below zero zooms out.
   */
  public step(direction: number): void {
    const current: number = this.percent();
    const next: number | undefined =
      direction > 0
        ? EDITOR_ZOOM_LEVELS.find((level: number): boolean => level > current)
        : [...EDITOR_ZOOM_LEVELS].reverse().find((level: number): boolean => level < current);
    if (next !== undefined) {
      this.set(next);
    }
  }
}
