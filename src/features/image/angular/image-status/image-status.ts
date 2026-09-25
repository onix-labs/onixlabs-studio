import { Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Describes what an image tab's status strip shows.
 */
export interface ImageContext {
  /**
   * Gets the image's absolute path.
   */
  readonly path: string;

  /**
   * Gets the image's format label (for example "PNG").
   */
  readonly format: string;

  /**
   * Gets the pixel dimensions label (for example "640 × 480"), or null until decoded.
   */
  readonly dimensions: string | null;

  /**
   * Gets the file size label (for example "12.4 KB"), or null until known.
   */
  readonly fileSize: string | null;

  /**
   * Gets the zoom label (for example "100%").
   */
  readonly zoom: string;

  /**
   * Gets a note about how editing behaves for this image, or null when there is nothing to say.
   */
  readonly note: string | null;

  /**
   * Gets a value indicating whether the image has unsaved edits.
   */
  readonly dirty: boolean;
}

/**
 * Holds one image tab's status context. Provided per view, so the shell's status strip — mounted
 * through the active view's injector — reads the context of the tab on screen and nothing else.
 */
@Service()
export class ImageStatus {
  /**
   * Holds the published context.
   */
  private readonly contextSignal: WritableSignal<ImageContext | null> = signal<ImageContext | null>(
    null,
  );

  /**
   * Gets the published context, or null when there is none.
   */
  public readonly context: Signal<ImageContext | null> = this.contextSignal.asReadonly();

  /**
   * Publishes the view's context.
   * @param context The context to show.
   */
  public publish(context: ImageContext): void {
    this.contextSignal.set(context);
  }

  /**
   * Clears the context.
   */
  public clear(): void {
    this.contextSignal.set(null);
  }
}
