// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { DatabaseValue, ResultColumn } from '@shared/api/database-engine-protocol';
import { toCsv, toXlsx } from './result-export';

/**
 * One file read back out of a zip archive.
 */
interface ZipFile {
  readonly name: string;
  readonly text: string;
  readonly crc: number;
  readonly method: number;
}

/**
 * Reads a zip archive the way an unzipper does: from the end-of-central-directory record, through
 * the central directory, to each file's local header and its deflated data.
 * @param bytes The archive.
 * @returns Returns its files, by name.
 */
function unzip(bytes: Uint8Array): ReadonlyMap<string, ZipFile> {
  const view: DataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder: TextDecoder = new TextDecoder();
  const end: number = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count: number = view.getUint16(end + 10, true);
  let at: number = view.getUint32(end + 16, true);
  const files: Map<string, ZipFile> = new Map<string, ZipFile>();
  for (let index: number = 0; index < count; index++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const method: number = view.getUint16(at + 10, true);
    const crc: number = view.getUint32(at + 16, true);
    const compressed: number = view.getUint32(at + 20, true);
    const size: number = view.getUint32(at + 24, true);
    const nameLength: number = view.getUint16(at + 28, true);
    const local: number = view.getUint32(at + 42, true);
    const name: string = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const start: number = local + 30 + view.getUint16(local + 26, true);
    const data: Buffer = inflateRawSync(bytes.subarray(start, start + compressed));
    expect(data.length).toBe(size);
    files.set(name, { name, text: data.toString('utf8'), crc, method });
    at += 46 + nameLength;
  }
  return files;
}

/**
 * Computes a CRC-32 independently of the code under test, bit by bit.
 * @param text The text, as UTF-8.
 * @returns Returns the checksum.
 */
function crcOf(text: string): number {
  let crc: number = 0xffffffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte;
    for (let bit: number = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Builds a workbook and reads back its sheet.
 * @param columns The columns.
 * @param rows The rows.
 * @returns Returns the sheet's XML.
 */
async function sheetOf(
  columns: readonly ResultColumn[],
  rows: readonly (readonly DatabaseValue[])[],
): Promise<string> {
  return unzip(await toXlsx(columns, rows)).get('xl/worksheets/sheet1.xml')?.text ?? '';
}

const COLUMNS: readonly ResultColumn[] = [{ name: 'id', type: 'int4' }, { name: 'name' }];

describe('toCsv', () => {
  it('writesAHeaderThenARowPerLine_eachEndingInCrLf', () => {
    expect(
      toCsv(COLUMNS, [
        [1, 'Ada'],
        [2, 'Grace'],
      ]),
    ).toBe('id,name\r\n1,Ada\r\n2,Grace\r\n');
  });

  it('withNoRows_isTheHeaderAlone', () => {
    expect(toCsv(COLUMNS, [])).toBe('id,name\r\n');
  });

  it('quotesAFieldHoldingACommaAQuoteOrALineBreak_doublingItsQuotes', () => {
    expect(
      toCsv(
        [{ name: 'a,b' }, { name: 'plain' }],
        [
          ['say "hi"', 'one\ntwo'],
          ['carriage\rreturn', 'fine'],
        ],
      ),
    ).toBe('"a,b",plain\r\n"say ""hi""","one\ntwo"\r\n"carriage\rreturn",fine\r\n');
  });

  it('writesANullCellEmpty_notAsTheGridsNull', () => {
    expect(toCsv(COLUMNS, [[null, 'NULL']])).toBe('id,name\r\n,NULL\r\n');
  });

  it('writesTypedCellsAsTheGridShowsThem', () => {
    const row: readonly DatabaseValue[] = [
      true,
      { type: 'bigint', value: '9007199254740993' },
      { type: 'temporal', value: '2026-10-27T10:00:00Z' },
      { type: 'json', value: { a: 1 } },
      { type: 'list', items: [1, 'x'] },
    ];

    expect(
      toCsv(
        row.map((_: DatabaseValue, index: number): ResultColumn => ({ name: `c${index}` })),
        [row],
      ),
    ).toBe('c0,c1,c2,c3,c4\r\ntrue,9007199254740993,2026-10-27T10:00:00Z,"{""a"":1}","[1, x]"\r\n');
  });
});

describe('toXlsx', () => {
  it('zipsTheSmallestWorkbookASpreadsheetOpens_eachPartDeflatedWithItsCrc', async () => {
    const files: ReadonlyMap<string, ZipFile> = unzip(await toXlsx(COLUMNS, [[1, 'Ada']]));

    expect([...files.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    for (const file of files.values()) {
      expect(file.method).toBe(8);
      expect(file.crc).toBe(crcOf(file.text));
      expect(file.text.startsWith('<?xml')).toBe(true);
    }
    expect(files.get('[Content_Types].xml')?.text).toContain('/xl/worksheets/sheet1.xml');
    expect(files.get('xl/workbook.xml')?.text).toContain('<sheet name="Results"');
    expect(files.get('xl/styles.xml')?.text).toContain('<font><b/>');
  });

  it('writesTheHeaderBoldAndFrozenAboveTheData', async () => {
    const sheet: string = await sheetOf(COLUMNS, []);

    expect(sheet).toContain(
      '<row r="1"><c t="inlineStr" s="1"><is><t xml:space="preserve">id</t></is></c>' +
        '<c t="inlineStr" s="1"><is><t xml:space="preserve">name</t></is></c></row>',
    );
    expect(sheet).toContain('ySplit="1"');
    expect(sheet).toContain('state="frozen"');
  });

  it('writesNumbersAsValues_andNullsEmpty', async () => {
    const sheet: string = await sheetOf(COLUMNS, [
      [42, null],
      [-1.5, null],
    ]);

    expect(sheet).toContain('<row r="2"><c><v>42</v></c><c/></row>');
    expect(sheet).toContain('<row r="3"><c><v>-1.5</v></c><c/></row>');
  });

  it('writesANonFiniteNumberAsText', async () => {
    const sheet: string = await sheetOf(
      [{ name: 'n' }],
      [[Number.NaN], [Number.POSITIVE_INFINITY]],
    );

    expect(sheet).toContain('<t xml:space="preserve">NaN</t>');
    expect(sheet).toContain('<t xml:space="preserve">Infinity</t>');
    expect(sheet).not.toContain('<v>NaN</v>');
  });

  it('writesBooleansAsBooleans', async () => {
    const sheet: string = await sheetOf([{ name: 'a' }, { name: 'b' }], [[true, false]]);

    expect(sheet).toContain('<row r="2"><c t="b"><v>1</v></c><c t="b"><v>0</v></c></row>');
  });

  it('writesABigIntegerAndAStringAsInlineText', async () => {
    const sheet: string = await sheetOf(COLUMNS, [
      [{ type: 'bigint', value: '9007199254740993' }, 'Ada'],
    ]);

    expect(sheet).toContain(
      '<row r="2"><c t="inlineStr"><is><t xml:space="preserve">9007199254740993</t></is></c>' +
        '<c t="inlineStr"><is><t xml:space="preserve">Ada</t></is></c></row>',
    );
  });

  it('escapesTextForXml', async () => {
    const sheet: string = await sheetOf([{ name: '<a & "b">' }], [['x < y & z > "w"']]);

    expect(sheet).toContain('&lt;a &amp; &quot;b&quot;&gt;');
    expect(sheet).toContain('x &lt; y &amp; z &gt; &quot;w&quot;');
  });

  it('dropsTheControlCharactersXmlCannotHold_keepingTabsAndLineBreaks', async () => {
    const sheet: string = await sheetOf(
      [{ name: 'n' }],
      [['a\u0000b\u0001c\u001Fd\tE\nF\rG\uFFFEH\uFFFF']],
    );

    expect(sheet).toContain('<t xml:space="preserve">abcd\tE\nF\rGH</t>');
  });

  it('keepsTextBeyondAsciiAsUtf8', async () => {
    const sheet: string = await sheetOf([{ name: 'n' }], [['café — 東京']]);

    expect(sheet).toContain('café — 東京');
  });
});
