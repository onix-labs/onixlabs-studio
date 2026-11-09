import { encodingLabel, isTextEncoding, textDecodeOptions } from './text-encodings';

describe('text encodings', () => {
  it('labels_nameABomOnlyForUtf8', () => {
    expect(encodingLabel('utf8')).toBe('UTF-8');
    expect(encodingLabel('utf8', true)).toBe('UTF-8 with BOM');
    expect(encodingLabel('utf16le', true)).toBe('UTF-16 LE');
    expect(encodingLabel('windows1252')).toBe('Windows 1252');
    expect(encodingLabel('iso88591')).toBe('ISO 8859-1');
  });

  it('isTextEncoding_knowsOnlyTheFive', () => {
    expect(isTextEncoding('utf16be')).toBe(true);
    expect(isTextEncoding('UTF-8')).toBe(false);
    expect(isTextEncoding(7)).toBe(false);
  });

  it('textDecodeOptions_keepsWhatItUnderstands_andDropsTheRest', () => {
    expect(textDecodeOptions({ encoding: 'utf8', fallback: 'nope', autoDetect: 'yes' })).toEqual({
      encoding: 'utf8',
    });
    expect(textDecodeOptions({ fallback: 'windows1252', autoDetect: false, extra: 1 })).toEqual({
      fallback: 'windows1252',
      autoDetect: false,
    });
    expect(textDecodeOptions(null)).toEqual({});
    expect(textDecodeOptions('utf8')).toEqual({});
  });
});
