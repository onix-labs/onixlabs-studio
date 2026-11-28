import { InjectionToken, Type } from '@angular/core';

/**
 * Describes a Studio window other than the first (#1587).
 */
export interface WindowFrameConfig {
  /**
   * Gets the window's identifier, which its tabs are recorded under.
   */
  readonly windowId: string;

  /**
   * Gets the window's document.
   */
  readonly document: Document;
}

/**
 * Carries a window's configuration into its frame.
 */
export const WINDOW_FRAME_CONFIG: InjectionToken<WindowFrameConfig> =
  new InjectionToken<WindowFrameConfig>('WINDOW_FRAME_CONFIG');

/**
 * Names the component a Studio window other than the first is rendered with. Provided by the
 * application's configuration rather than imported by the windows service, because the frame holds
 * the title strip, whose tab menu opens windows: importing it there would make the two depend on each
 * other.
 */
export const WINDOW_FRAME: InjectionToken<Type<unknown>> = new InjectionToken<Type<unknown>>(
  'WINDOW_FRAME',
);
