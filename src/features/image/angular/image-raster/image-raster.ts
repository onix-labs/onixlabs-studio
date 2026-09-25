import { Service } from '@angular/core';
import { EncodableImageType } from '@shared/api/image-formats';
import { ImageEdit, ImageSize, sizeAfter } from '../image-geometry/image-geometry';

/**
 * Describes a raster the viewer can draw from: the decoded file or an edited canvas, with the pixel
 * size it is drawn at. An SVG decodes without a natural size of its own in some cases, so the size is
 * carried beside the source rather than read back from it.
 */
export interface Raster {
  /**
   * Gets the drawable source.
   */
  readonly source: CanvasImageSource;

  /**
   * Gets the raster's size, in pixels.
   */
  readonly size: ImageSize;
}

/**
 * Specifies the size an SVG with no intrinsic size is rasterised at — the browser's own default for a
 * replaced element with none.
 */
const DEFAULT_VECTOR_SIZE: ImageSize = { width: 300, height: 150 };

/**
 * Performs the viewer's pixel work on `<canvas>`: decoding a file, applying an edit, and encoding the
 * result. Everything that needs a real 2D context is here, behind one service, so the document model
 * that drives it can be exercised without a canvas implementation.
 */
@Service()
export class ImageRaster {
  /**
   * Decodes an image from a URL.
   * @param url The image's URL (a `studio-media://` URL for a file on disk).
   * @returns Returns the decoded image and its size; rejects when it cannot be decoded.
   */
  public async decode(url: string): Promise<Raster> {
    const image: HTMLImageElement = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    const size: ImageSize =
      image.naturalWidth > 0 && image.naturalHeight > 0
        ? { width: image.naturalWidth, height: image.naturalHeight }
        : DEFAULT_VECTOR_SIZE;
    return { source: image, size };
  }

  /**
   * Applies an edit to a raster, drawing the result into a new canvas. Only the current frame of an
   * animated source is drawn, so an edit flattens an animation.
   * @param raster The raster to edit.
   * @param edit The edit to apply.
   * @returns Returns the edited raster.
   */
  public apply(raster: Raster, edit: ImageEdit): Raster {
    const size: ImageSize = sizeAfter(raster.size, edit);
    const canvas: HTMLCanvasElement = this.canvas(size);
    const context: CanvasRenderingContext2D = this.context(canvas);
    const { width, height }: ImageSize = raster.size;
    switch (edit.kind) {
      case 'rotate':
        context.translate(size.width / 2, size.height / 2);
        context.rotate(((edit.clockwise ? 1 : -1) * Math.PI) / 2);
        context.drawImage(raster.source, -width / 2, -height / 2, width, height);
        break;
      case 'flip':
        if (edit.axis === 'horizontal') {
          context.translate(width, 0);
          context.scale(-1, 1);
        } else {
          context.translate(0, height);
          context.scale(1, -1);
        }
        context.drawImage(raster.source, 0, 0, width, height);
        break;
      case 'crop': {
        const { x, y, width: cropWidth, height: cropHeight } = edit.rect;
        context.drawImage(raster.source, x, y, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
        break;
      }
      case 'resize':
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(raster.source, 0, 0, size.width, size.height);
        break;
    }
    return { source: canvas, size };
  }

  /**
   * Draws a raster at a given size into a new canvas — how an SVG is rasterised for export, and how
   * any source is scaled on its way out.
   * @param raster The raster to draw.
   * @param size The size to draw it at.
   * @returns Returns the drawn raster.
   */
  public draw(raster: Raster, size: ImageSize): Raster {
    const canvas: HTMLCanvasElement = this.canvas(size);
    const context: CanvasRenderingContext2D = this.context(canvas);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(raster.source, 0, 0, size.width, size.height);
    return { source: canvas, size };
  }

  /**
   * Encodes a raster in a format Chromium can write.
   * @param raster The raster to encode.
   * @param type The format to encode it in.
   * @param quality The quality from 0 to 1, for the lossy formats; ignored for PNG.
   * @returns Returns the encoded file's bytes; rejects when encoding fails.
   */
  public async encode(
    raster: Raster,
    type: EncodableImageType,
    quality: number,
  ): Promise<Uint8Array> {
    const blob: Blob = await this.toBlob(this.asCanvas(raster), type, quality);
    return new Uint8Array(await blob.arrayBuffer());
  }

  /**
   * Creates an object URL showing a raster, so an edited image displays through an ordinary `<img>`
   * exactly as the file does. The caller revokes it with {@link revoke} when it is replaced.
   * @param raster The raster to show.
   * @returns Returns the object URL.
   */
  public async objectUrl(raster: Raster): Promise<string> {
    return URL.createObjectURL(await this.toBlob(this.asCanvas(raster), 'image/png', 1));
  }

  /**
   * Revokes an object URL made by {@link objectUrl}.
   * @param url The URL to revoke.
   */
  public revoke(url: string): void {
    URL.revokeObjectURL(url);
  }

  /**
   * Gets a raster as a canvas, drawing it into one when it is a decoded file.
   * @param raster The raster.
   * @returns Returns a canvas holding the raster's pixels.
   */
  private asCanvas(raster: Raster): HTMLCanvasElement {
    return raster.source instanceof HTMLCanvasElement
      ? raster.source
      : (this.draw(raster, raster.size).source as HTMLCanvasElement);
  }

  /**
   * Creates a canvas of a given size.
   * @param size The canvas's size.
   * @returns Returns the canvas.
   */
  private canvas(size: ImageSize): HTMLCanvasElement {
    const canvas: HTMLCanvasElement = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    return canvas;
  }

  /**
   * Gets a canvas's 2D context.
   * @param canvas The canvas.
   * @returns Returns the context; throws when the canvas cannot provide one (out of memory).
   */
  private context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const context: CanvasRenderingContext2D | null = canvas.getContext('2d');
    if (context === null) {
      throw new Error(`Could not allocate a ${canvas.width} × ${canvas.height} canvas`);
    }
    return context;
  }

  /**
   * Encodes a canvas to a blob.
   * @param canvas The canvas.
   * @param type The format.
   * @param quality The lossy quality.
   * @returns Returns the blob; rejects when the canvas could not be encoded.
   */
  private toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
    return new Promise<Blob>(
      (resolve: (blob: Blob) => void, reject: (error: Error) => void): void => {
        canvas.toBlob(
          (blob: Blob | null): void =>
            blob === null ? reject(new Error(`Could not encode ${type}`)) : resolve(blob),
          type,
          quality,
        );
      },
    );
  }
}
