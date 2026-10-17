import { EncodableImageType } from '@shared/api/image-formats';
import { ImageEdit, ImageSize, sizeAfter } from '../image-geometry/image-geometry';
import { Raster } from '../image-raster/image-raster';

/**
 * Stands in for the canvas work: every raster is a size and an empty source, decoding yields a
 * 40 × 30 image, and encoding yields five bytes.
 */
export class FakeImageRaster {
  /**
   * Gets whether decoding fails.
   */
  public failDecode: boolean = false;

  /**
   * Gets the object URLs revoked.
   */
  public readonly revoked: string[] = [];

  /**
   * Gets the formats encoded to.
   */
  public readonly encoded: EncodableImageType[] = [];

  /**
   * Counts the object URLs made.
   */
  private urls: number = 0;

  /**
   * Decodes a 40 × 30 image, or fails when {@link failDecode} is set.
   * @returns Returns the decoded raster.
   */
  public decode(): Promise<Raster> {
    return this.failDecode
      ? Promise.reject(new Error('undecodable'))
      : Promise.resolve(this.raster({ width: 40, height: 30 }));
  }

  /**
   * Applies an edit, producing a raster of the edited size.
   * @param raster The raster to edit.
   * @param edit The edit.
   * @returns Returns the edited raster.
   */
  public apply(raster: Raster, edit: ImageEdit): Raster {
    return this.raster(sizeAfter(raster.size, edit));
  }

  /**
   * Draws a raster at a size.
   * @param _raster The raster to draw.
   * @param size The size to draw it at.
   * @returns Returns the drawn raster.
   */
  public draw(_raster: Raster, size: ImageSize): Raster {
    return this.raster(size);
  }

  /**
   * Encodes a raster to five bytes, recording the format.
   * @param _raster The raster to encode.
   * @param type The format.
   * @returns Returns the encoded bytes.
   */
  public encode(_raster: Raster, type: EncodableImageType): Promise<Uint8Array> {
    this.encoded.push(type);
    return Promise.resolve(new Uint8Array(5));
  }

  /**
   * Makes a numbered object URL.
   * @returns Returns the URL.
   */
  public objectUrl(): Promise<string> {
    this.urls += 1;
    return Promise.resolve(`blob:edited-${this.urls}`);
  }

  /**
   * Records a revoked object URL.
   * @param url The URL.
   */
  public revoke(url: string): void {
    this.revoked.push(url);
  }

  /**
   * Builds a raster of a size.
   * @param size The size.
   * @returns Returns the raster.
   */
  private raster(size: ImageSize): Raster {
    return { source: {} as CanvasImageSource, size };
  }
}
