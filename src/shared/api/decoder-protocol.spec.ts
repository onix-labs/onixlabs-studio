import { describe, expect, it } from 'vitest';
import {
  DECODER_FORMATS,
  DECODER_PROTOCOL_VERSION,
  decoderFormatKey,
  isCompatibleProtocol,
} from './decoder-protocol';

describe('decoderFormatKey', (): void => {
  it('builds a container/architecture key', (): void => {
    expect(decoderFormatKey('elf', 'x64')).toBe('elf/x64');
  });

  it('lower-cases the architecture, because the sniffer capitalises for display only', (): void => {
    expect(decoderFormatKey('pe', 'ARM64')).toBe('pe/arm64');
    expect(decoderFormatKey('macho', 'ARM')).toBe('macho/arm');
  });

  it('normalises the hyphenated RISC-V label the sniffer produces', (): void => {
    expect(decoderFormatKey('elf', 'RISC-V')).toBe('elf/riscv');
  });

  it('names a container with no varying architecture alone', (): void => {
    expect(decoderFormatKey('jvm')).toBe('jvm');
    expect(decoderFormatKey('wasm')).toBe('wasm');
  });

  it('produces keys that are in the canonical list', (): void => {
    // The whole point of the key is that the sniffer and a manifest spell the same thing; a key that
    // is not canonical would never match, and the decoder would appear installed but inert.
    for (const [container, architecture] of [
      ['pe', 'x64'],
      ['elf', 'ARM64'],
      ['macho', 'x86'],
      ['elf', 'RISC-V'],
    ] as const) {
      expect(DECODER_FORMATS).toContain(decoderFormatKey(container, architecture));
    }
    expect(DECODER_FORMATS).toContain(decoderFormatKey('jvm'));
    expect(DECODER_FORMATS).toContain(decoderFormatKey('wasm'));
  });
});

describe('DECODER_FORMATS', (): void => {
  it('holds no duplicates, so a key resolves to one meaning', (): void => {
    expect(new Set(DECODER_FORMATS).size).toBe(DECODER_FORMATS.length);
  });
});

describe('isCompatibleProtocol', (): void => {
  it('accepts the exact version', (): void => {
    expect(isCompatibleProtocol(DECODER_PROTOCOL_VERSION)).toBe(true);
  });

  it('accepts a newer minor version, which may add capability this build ignores', (): void => {
    expect(isCompatibleProtocol('1.7')).toBe(true);
  });

  it('refuses a different major version', (): void => {
    // A decoder that misreads a byte range returns a plausible wrong listing rather than an obvious
    // failure, so a major mismatch is refused rather than attempted.
    expect(isCompatibleProtocol('2.0')).toBe(false);
    expect(isCompatibleProtocol('0.9')).toBe(false);
  });
});
