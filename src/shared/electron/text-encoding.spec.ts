import { TEXT_ENCODINGS, type TextEncoding } from '@shared/api/text-encodings';
import { decodeText, encodeText, hasUtf16ByteOrderMark } from './text-encoding';

describe('text encoding', () => {
  /**
   * Holds text every encoding can hold: ASCII, accents and the euro sign (in Windows 1252's high
   * range, though not ISO 8859-1's).
   */
  const LATIN: string = 'Café au lait\r\nnaïve ñ ¿?';

  it('roundTrips_inEveryEncoding_withAndWithoutAByteOrderMark', () => {
    for (const encoding of TEXT_ENCODINGS) {
      for (const bom of [false, true]) {
        const bytes: Buffer = encodeText(LATIN, encoding, bom);
        expect(decodeText(bytes, { encoding }).text).toBe(LATIN);
      }
    }
  });

  it('windows1252_holdsItsHighRange_andTheC1ControlsItLeavesUndefined', () => {
    const text: string = '€ “quoted” – ‘single’ … ™ Ÿ \u0081\u008d\u008f\u0090\u009d';

    const bytes: Buffer = encodeText(text, 'windows1252');

    expect(bytes[0]).toBe(0x80);
    expect(decodeText(bytes, { encoding: 'windows1252' }).text).toBe(text);
  });

  it('singleByteEncodings_refuseACharacterTheyHaveNoByteFor', () => {
    expect(() => encodeText('price: €5', 'iso88591')).toThrow(/ISO 8859-1.*“€”/);
    expect(() => encodeText('check ✓', 'windows1252')).toThrow(/Windows 1252.*“✓”/);
  });

  it('utf16be_isLittleEndianSwapped', () => {
    expect([...encodeText('A', 'utf16be', true)]).toEqual([0xfe, 0xff, 0x00, 0x41]);
    expect([...encodeText('A', 'utf16le', true)]).toEqual([0xff, 0xfe, 0x41, 0x00]);
  });

  it('aByteOrderMark_namesTheEncoding_andIsStripped', () => {
    const cases: readonly [TextEncoding, boolean][] = [
      ['utf8', true],
      ['utf16le', true],
      ['utf16be', true],
    ];
    for (const [encoding, bom] of cases) {
      expect(decodeText(encodeText('hi', encoding, bom), { fallback: 'iso88591' })).toEqual({
        text: 'hi',
        encoding,
        bom: true,
      });
    }
  });

  it('autoDetect_readsValidUtf8AsUtf8_andAnythingElseInTheFallback', () => {
    const utf8: Buffer = encodeText('naïve', 'utf8');
    const latin: Buffer = encodeText('naïve', 'iso88591');

    expect(decodeText(utf8, { fallback: 'iso88591' }).encoding).toBe('utf8');
    expect(decodeText(latin, { fallback: 'iso88591' })).toEqual({
      text: 'naïve',
      encoding: 'iso88591',
      bom: false,
    });
    // A UTF fallback cannot read what is not UTF-8; Windows 1252 reads every byte and writes it back.
    expect(decodeText(latin, { fallback: 'utf8' }).encoding).toBe('windows1252');
  });

  it('withoutAutoDetect_theFallbackIsUsed_butAByteOrderMarkIsStillHonoured', () => {
    const ascii: Buffer = encodeText('plain', 'utf8');

    expect(decodeText(ascii, { fallback: 'windows1252', autoDetect: false }).encoding).toBe(
      'windows1252',
    );
    expect(
      decodeText(encodeText('x', 'utf16le', true), { fallback: 'windows1252', autoDetect: false })
        .encoding,
    ).toBe('utf16le');
  });

  it('aForcedEncoding_winsOverWhatTheBytesSuggest', () => {
    const utf8: Buffer = encodeText('naïve', 'utf8');

    expect(decodeText(utf8, { encoding: 'iso88591' })).toEqual({
      text: 'naÃ¯ve',
      encoding: 'iso88591',
      bom: false,
    });
  });

  it('hasUtf16ByteOrderMark_tellsUtf16TextFromBinary', () => {
    expect(hasUtf16ByteOrderMark(encodeText('a', 'utf16le', true))).toBe(true);
    expect(hasUtf16ByteOrderMark(encodeText('a', 'utf16be', true))).toBe(true);
    expect(hasUtf16ByteOrderMark(Buffer.from([0x00, 0x01]))).toBe(false);
  });
});
