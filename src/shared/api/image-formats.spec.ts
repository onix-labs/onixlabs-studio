import { describe, expect, it } from 'vitest';
import {
  ENCODABLE_IMAGE_TYPES,
  IMAGE_MIME_TYPES,
  imageExtensionOf,
  imageMimeTypeOf,
  isEncodableImageType,
} from './image-formats';

describe('image formats', () => {
  it('imageExtensionOf_readsTheLowercasedExtensionFromEitherSeparator', () => {
    expect(imageExtensionOf('/pictures/Photo.PNG')).toBe('.png');
    expect(imageExtensionOf('C:\\art\\logo.svg')).toBe('.svg');
    expect(imageExtensionOf('/dir.with.dots/README')).toBe('');
    expect(imageExtensionOf('/home/.hidden')).toBe('');
  });

  it('imageMimeTypeOf_recognisesEveryDisplayableFormatIncludingSvg', () => {
    expect(imageMimeTypeOf('/a.jpeg')).toBe('image/jpeg');
    expect(imageMimeTypeOf('/a.svg')).toBe('image/svg+xml');
    expect(imageMimeTypeOf('/a.tiff')).toBeUndefined();
    expect(imageMimeTypeOf('/a.ts')).toBeUndefined();
  });

  it('isEncodableImageType_acceptsOnlyWhatCanvasCanWrite', () => {
    expect(isEncodableImageType('image/png')).toBe(true);
    expect(isEncodableImageType('image/webp')).toBe(true);
    expect(isEncodableImageType('image/gif')).toBe(false);
    expect(isEncodableImageType('image/svg+xml')).toBe(false);
  });

  it('encodableTypes_areAllDisplayableTypes', () => {
    const displayable: ReadonlySet<string> = new Set<string>(IMAGE_MIME_TYPES.values());
    for (const type of ENCODABLE_IMAGE_TYPES) {
      expect(displayable.has(type)).toBe(true);
    }
  });
});
