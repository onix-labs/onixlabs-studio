/**
 * Describes a size in pixels.
 */
export interface ImageSize {
  /**
   * Gets the width, in pixels.
   */
  readonly width: number;

  /**
   * Gets the height, in pixels.
   */
  readonly height: number;
}

/**
 * Describes a rectangle in image pixels, measured from the image's top-left corner.
 */
export interface ImageRect {
  /**
   * Gets the left edge, in pixels.
   */
  readonly x: number;

  /**
   * Gets the top edge, in pixels.
   */
  readonly y: number;

  /**
   * Gets the width, in pixels.
   */
  readonly width: number;

  /**
   * Gets the height, in pixels.
   */
  readonly height: number;
}

/**
 * Describes one raster edit. Every edit produces a new raster from the current one; none of them
 * touch the file until the document is saved.
 */
export type ImageEdit =
  | { readonly kind: 'rotate'; readonly clockwise: boolean }
  | { readonly kind: 'flip'; readonly axis: 'horizontal' | 'vertical' }
  | { readonly kind: 'crop'; readonly rect: ImageRect }
  | { readonly kind: 'resize'; readonly width: number; readonly height: number };

/**
 * Specifies the smallest zoom the viewer allows, as a scale factor.
 */
export const MIN_ZOOM: number = 0.02;

/**
 * Specifies the largest zoom the viewer allows, as a scale factor.
 */
export const MAX_ZOOM: number = 32;

/**
 * Lists the zoom stops the zoom-in and zoom-out commands step between, as scale factors.
 */
export const ZOOM_STEPS: readonly number[] = [
  0.05,
  0.1,
  0.125,
  0.25,
  1 / 3,
  0.5,
  2 / 3,
  0.75,
  1,
  1.25,
  1.5,
  2,
  3,
  4,
  6,
  8,
  12,
  16,
  24,
  32,
];

/**
 * Specifies the largest edge, in pixels, the resize command accepts — beyond it a canvas cannot be
 * allocated reliably.
 */
export const MAX_EDGE: number = 16384;

/**
 * Clamps a zoom scale into the allowed range.
 * @param scale The scale to clamp.
 * @returns Returns the clamped scale.
 */
export function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/**
 * Computes the scale that fits an image inside a viewport without cropping it. A small image is not
 * blown up: fitting never zooms beyond 1:1, so an icon opens at its real size.
 * @param image The image's size.
 * @param viewport The viewport's size.
 * @returns Returns the fitting scale, or 1 when either size is empty.
 */
export function fitScale(image: ImageSize, viewport: ImageSize): number {
  if (image.width <= 0 || image.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return 1;
  }
  return clampZoom(Math.min(1, viewport.width / image.width, viewport.height / image.height));
}

/**
 * Finds the next zoom stop above a scale.
 * @param scale The current scale.
 * @returns Returns the next larger stop, or the maximum zoom when there is none.
 */
export function zoomInFrom(scale: number): number {
  return ZOOM_STEPS.find((step: number): boolean => step > scale * 1.001) ?? MAX_ZOOM;
}

/**
 * Finds the next zoom stop below a scale.
 * @param scale The current scale.
 * @returns Returns the next smaller stop, or the minimum zoom when there is none.
 */
export function zoomOutFrom(scale: number): number {
  return (
    [...ZOOM_STEPS].reverse().find((step: number): boolean => step < scale / 1.001) ?? MIN_ZOOM
  );
}

/**
 * Computes the size an edit leaves an image at.
 * @param size The size before the edit.
 * @param edit The edit.
 * @returns Returns the size after the edit.
 */
export function sizeAfter(size: ImageSize, edit: ImageEdit): ImageSize {
  switch (edit.kind) {
    case 'rotate':
      return { width: size.height, height: size.width };
    case 'flip':
      return size;
    case 'crop':
      return { width: edit.rect.width, height: edit.rect.height };
    case 'resize':
      return { width: edit.width, height: edit.height };
  }
}

/**
 * Normalises a rectangle dragged between two points — in any direction — into whole image pixels,
 * clamped to the image.
 * @param from The point the drag started at, in image pixels.
 * @param from.x The start point's horizontal position.
 * @param from.y The start point's vertical position.
 * @param to The point the drag is at, in image pixels.
 * @param to.x The end point's horizontal position.
 * @param to.y The end point's vertical position.
 * @param bounds The image's size.
 * @returns Returns the clamped rectangle; it may be empty when the drag has not moved.
 */
export function rectBetween(
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  bounds: ImageSize,
): ImageRect {
  const clampX: (value: number) => number = (value: number): number =>
    Math.min(bounds.width, Math.max(0, Math.round(value)));
  const clampY: (value: number) => number = (value: number): number =>
    Math.min(bounds.height, Math.max(0, Math.round(value)));
  const left: number = clampX(Math.min(from.x, to.x));
  const top: number = clampY(Math.min(from.y, to.y));
  const right: number = clampX(Math.max(from.x, to.x));
  const bottom: number = clampY(Math.max(from.y, to.y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Determines whether a crop rectangle keeps at least one pixel and is not the whole image, so
 * applying it would change something.
 * @param rect The crop rectangle.
 * @param bounds The image's size.
 * @returns Returns true when the crop is worth applying.
 */
export function isUsefulCrop(rect: ImageRect, bounds: ImageSize): boolean {
  const whole: boolean =
    rect.x === 0 && rect.y === 0 && rect.width === bounds.width && rect.height === bounds.height;
  return rect.width >= 1 && rect.height >= 1 && !whole;
}

/**
 * Computes the other edge of a resize from the edge the user changed, keeping the aspect ratio.
 * @param original The size being resized.
 * @param changed The edge the user edited.
 * @param value The new length of that edge, in pixels.
 * @returns Returns the new size, both edges whole pixels of at least one.
 */
export function resizeKeepingAspect(
  original: ImageSize,
  changed: 'width' | 'height',
  value: number,
): ImageSize {
  const length: number = clampEdge(value);
  if (original.width <= 0 || original.height <= 0) {
    return { width: length, height: length };
  }
  return changed === 'width'
    ? { width: length, height: clampEdge((length * original.height) / original.width) }
    : { width: clampEdge((length * original.width) / original.height), height: length };
}

/**
 * Scales a size by a percentage.
 * @param original The size being scaled.
 * @param percent The percentage to scale to (100 is unchanged).
 * @returns Returns the scaled size, both edges whole pixels of at least one.
 */
export function scaleByPercent(original: ImageSize, percent: number): ImageSize {
  const factor: number = Math.max(0, percent) / 100;
  return {
    width: clampEdge(original.width * factor),
    height: clampEdge(original.height * factor),
  };
}

/**
 * Rounds an edge length to a whole pixel within the allowed range.
 * @param value The edge length.
 * @returns Returns the clamped, rounded length.
 */
export function clampEdge(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(MAX_EDGE, Math.max(1, Math.round(value)));
}

/**
 * Formats a byte count for the status strip, in the binary units file managers use.
 * @param bytes The size in bytes.
 * @returns Returns a label such as "812 B", "12.4 KB" or "3.1 MB".
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units: readonly string[] = ['KB', 'MB', 'GB'];
  let value: number = bytes / 1024;
  let unit: number = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/**
 * Formats a zoom scale as a whole percentage.
 * @param scale The scale factor.
 * @returns Returns a label such as "100%".
 */
export function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}
