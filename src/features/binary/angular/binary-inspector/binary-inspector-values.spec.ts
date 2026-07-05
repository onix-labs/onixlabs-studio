import { inspectBytes, InspectorRow } from './binary-inspector-values';

/**
 * Reads the decoded value of a labelled row from an inspector result.
 * @param rows The inspector rows.
 * @param label The row label to read.
 * @returns Returns the decoded value.
 */
function value(rows: readonly InspectorRow[], label: string): string {
  return rows.find((row: InspectorRow): boolean => row.label === label)!.value;
}

describe('inspectBytes', () => {
  const sequence: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8];

  it('decodesUnsignedIntegersLittleEndian', () => {
    const rows: readonly InspectorRow[] = inspectBytes(sequence, true, false);
    expect(value(rows, 'Byte')).toBe('1');
    expect(value(rows, 'Word')).toBe('513'); // 0x0201
    expect(value(rows, 'Integer')).toBe('67305985'); // 0x04030201
    expect(value(rows, 'Long')).toBe('578437695752307201'); // 0x0807060504030201
  });

  it('decodesUnsignedIntegersBigEndian', () => {
    const rows: readonly InspectorRow[] = inspectBytes(sequence, false, false);
    expect(value(rows, 'Word')).toBe('258'); // 0x0102
    expect(value(rows, 'Integer')).toBe('16909060'); // 0x01020304
  });

  it('appliesSignednessToTheIntegerInterpretations', () => {
    const signed: readonly InspectorRow[] = inspectBytes([0x80], true, true);
    const unsigned: readonly InspectorRow[] = inspectBytes([0x80], true, false);
    expect(value(signed, 'Byte')).toBe('-128');
    expect(value(unsigned, 'Byte')).toBe('128');

    const signedWord: readonly InspectorRow[] = inspectBytes([0xff, 0xff], true, true);
    expect(value(signedWord, 'Word')).toBe('-1');
    expect(value(inspectBytes([0xff, 0xff], true, false), 'Word')).toBe('65535');
  });

  it('decodesFloatsByEndianness', () => {
    // 1.0 as IEEE-754 single, little-endian byte order.
    const rows: readonly InspectorRow[] = inspectBytes([0x00, 0x00, 0x80, 0x3f], true, false);
    expect(value(rows, 'Float')).toBe('1');
  });

  it('marksTypesUnavailableWhenTooFewBytesAreLoaded', () => {
    const rows: readonly InspectorRow[] = inspectBytes(
      [0x41, null, null, null, null, null, null, null],
      true,
      false,
    );
    expect(value(rows, 'Byte')).toBe('65');
    expect(value(rows, 'Word')).toBe('—');
    expect(value(rows, 'Integer')).toBe('—');
    expect(value(rows, 'Float')).toBe('—');
    expect(value(rows, 'Long')).toBe('—');
  });

  it('rendersCharacterAndStringInterpretations', () => {
    const printable: readonly InspectorRow[] = inspectBytes([0x48, 0x69, 0x00], true, false);
    expect(value(printable, 'Character')).toBe('H');
    expect(value(printable, 'String')).toBe('Hi'); // stops at the NUL

    const control: readonly InspectorRow[] = inspectBytes([0x0a], true, false);
    expect(value(control, 'Character')).toBe('0x0A');
    expect(value(control, 'String')).toBe('—'); // first byte is not printable
  });
});
