import { textFileLimitBytes, textReadPolicy } from './text-file-limit';

describe('textFileLimitBytes', () => {
  const MB: number = 1024 * 1024;

  it('takesLargeFileSizeLimit_inMegabytes', () => {
    expect(textFileLimitBytes(10)).toBe(10 * MB);
    expect(textFileLimitBytes(250)).toBe(250 * MB);
  });

  it('fallsBackTo50MB_whenTheRendererSaysNothingUsable', () => {
    for (const value of [undefined, null, 0, -5, Number.NaN, Infinity, '100']) {
      expect(textFileLimitBytes(value)).toBe(50 * MB);
    }
  });

  it('clampsToOneGigabyte_andAtLeastOneMegabyte', () => {
    expect(textFileLimitBytes(10_000)).toBe(1024 * MB);
    expect(textFileLimitBytes(0.25)).toBe(1 * MB);
  });
});

describe('textReadPolicy', () => {
  it('readsTheLimitAndTheDecodeOptions_droppingWhatItDoesNotUnderstand', () => {
    expect(
      textReadPolicy(10, { fallback: 'windows1252', autoDetect: false, encoding: 'ebcdic' }),
    ).toEqual({
      limit: 10 * 1024 * 1024,
      decode: { fallback: 'windows1252', autoDetect: false },
    });
    expect(textReadPolicy(undefined, 'utf8').decode).toEqual({});
  });
});
