import { DatabaseValue, ResultColumn } from '@shared/api/database-engine-protocol';
import { cellText, plainValue } from '../database-values';

/**
 * How a CSV export is written, from the user's settings.
 */
export interface CsvOptions {
  /**
   * Gets the character between fields.
   */
  readonly delimiter?: string;

  /**
   * Gets whether the first line names the columns.
   */
  readonly header?: boolean;

  /**
   * Gets what a NULL is written as.
   */
  readonly nullText?: string;
}

/**
 * Turns a result set into a CSV document (RFC 4180): a header row of the column names, then one line
 * per row, CRLF-terminated, with any field holding the delimiter, a quote or a line break quoted. A
 * NULL cell is empty unless the options say otherwise; every other cell is written as it was sent.
 * @param columns The result's columns.
 * @param rows The rows.
 * @param options How to write it.
 * @returns Returns the CSV text, without a byte-order mark.
 */
export function toCsv(
  columns: readonly ResultColumn[],
  rows: readonly (readonly DatabaseValue[])[],
  options?: CsvOptions,
): string {
  const delimiter: string = options?.delimiter ?? ',';
  const nullText: string = options?.nullText ?? '';
  const line: (fields: readonly string[]) => string = (fields: readonly string[]): string =>
    fields.map((field: string): string => csvField(field, delimiter)).join(delimiter);
  return [
    ...(options?.header === false
      ? []
      : [line(columns.map((column: ResultColumn): string => column.name))]),
    ...rows.map((row: readonly DatabaseValue[]): string =>
      line(
        row.map((value: DatabaseValue): string =>
          value === null ? nullText : cellText(value).text,
        ),
      ),
    ),
  ]
    .map((text: string): string => `${text}\r\n`)
    .join('');
}

/**
 * Quotes one CSV field when it must be.
 * @param field The field.
 * @param delimiter The character between fields.
 * @returns Returns it as it is written.
 */
function csvField(field: string, delimiter: string): string {
  return field.includes(delimiter) || /["\r\n]/.test(field)
    ? `"${field.replaceAll('"', '""')}"`
    : field;
}

/**
 * Turns a result set into a JSON document: an array with one object per row, keyed by column name.
 * Values are written as the plain JSON the Raw view shows, so a NULL stays null and a number a number.
 * A column name returned twice keeps its last value, as the Raw view's does.
 * @param columns The result's columns.
 * @param rows The rows.
 * @returns Returns the JSON text.
 */
export function toJson(
  columns: readonly ResultColumn[],
  rows: readonly (readonly DatabaseValue[])[],
): string {
  const names: readonly string[] = columns.map((column: ResultColumn): string => column.name);
  const objects: readonly unknown[] = rows.map((row: readonly DatabaseValue[]) =>
    Object.fromEntries(
      row.map((value: DatabaseValue, index: number): [string, unknown] => [
        names[index] ?? `${index}`,
        plainValue(value),
      ]),
    ),
  );
  return `${JSON.stringify(objects, null, 2)}\n`;
}

/**
 * Turns a result set into a Markdown table (GitHub-flavoured): a header row of the column names, the
 * divider, then one line per row. A pipe in a cell is escaped and a line break becomes `<br>`, so a
 * cell never breaks the table; a NULL cell is written as the given text.
 * @param columns The result's columns.
 * @param rows The rows.
 * @param nullText What a NULL is written as.
 * @returns Returns the Markdown text.
 */
export function toMarkdown(
  columns: readonly ResultColumn[],
  rows: readonly (readonly DatabaseValue[])[],
  nullText: string = '',
): string {
  const line: (fields: readonly string[]) => string = (fields: readonly string[]): string =>
    `| ${fields.map(markdownField).join(' | ')} |`;
  return [
    line(columns.map((column: ResultColumn): string => column.name)),
    `|${columns.map((): string => ' --- ').join('|')}|`,
    ...rows.map((row: readonly DatabaseValue[]): string =>
      line(
        columns.map((_column: ResultColumn, index: number): string => {
          const value: DatabaseValue = row[index] ?? null;
          return value === null ? nullText : cellText(value).text;
        }),
      ),
    ),
  ]
    .map((text: string): string => `${text}\n`)
    .join('');
}

/**
 * Makes one value safe in a Markdown table cell.
 * @param field The value as text.
 * @returns Returns it escaped.
 */
function markdownField(field: string): string {
  return field
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replace(/\r\n|\r|\n/g, '<br>');
}

/**
 * Turns rows into tab-separated text with a header row, as a spreadsheet pastes it: one line per row,
 * a tab between cells. A tab or line break inside a cell becomes a space, since the format has no way
 * to quote one; a NULL cell is written as the given text.
 * @param columns The result's columns.
 * @param rows The rows.
 * @param nullText What a NULL is written as.
 * @returns Returns the text.
 */
export function toTsv(
  columns: readonly ResultColumn[],
  rows: readonly (readonly DatabaseValue[])[],
  nullText: string = '',
): string {
  const line: (fields: readonly string[]) => string = (fields: readonly string[]): string =>
    fields.map((field: string): string => field.replace(/\t|\r\n|\r|\n/g, ' ')).join('\t');
  return [
    line(columns.map((column: ResultColumn): string => column.name)),
    ...rows.map((row: readonly DatabaseValue[]): string =>
      line(
        columns.map((_column: ResultColumn, index: number): string => {
          const value: DatabaseValue = row[index] ?? null;
          return value === null ? nullText : cellText(value).text;
        }),
      ),
    ),
  ]
    .map((text: string): string => `${text}\n`)
    .join('');
}

/**
 * Turns a result set into an Excel workbook (`.xlsx`): one sheet, the column names as a bold header
 * row frozen above the data. Numbers and booleans are written as such, so they sort and sum in Excel;
 * a big integer is written as text, since Excel keeps only fifteen significant digits; every other
 * cell as the grid shows it, and a NULL cell is left empty.
 *
 * The workbook is the smallest a spreadsheet opens: a sheet of inline strings, a style for the
 * header, and the parts that tie them together, zipped with the browser's own deflate.
 * @param columns The result's columns.
 * @param rows The rows.
 * @returns Returns a promise resolving the file's bytes.
 */
export async function toXlsx(
  columns: readonly ResultColumn[],
  rows: readonly (readonly DatabaseValue[])[],
): Promise<Uint8Array> {
  const header: string = `<row r="1">${columns
    .map((column: ResultColumn): string => stringCell(column.name, 1))
    .join('')}</row>`;
  const body: string = rows
    .map(
      (row: readonly DatabaseValue[], index: number): string =>
        `<row r="${index + 2}">${row.map(valueCell).join('')}</row>`,
    )
    .join('');
  const sheet: string =
    `${XML_HEAD}<worksheet xmlns="${MAIN_NS}"><sheetViews><sheetView workbookViewId="0">` +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView>' +
    `</sheetViews><sheetData>${header}${body}</sheetData></worksheet>`;
  return zip([
    { name: '[Content_Types].xml', text: CONTENT_TYPES },
    { name: '_rels/.rels', text: ROOT_RELS },
    { name: 'xl/workbook.xml', text: WORKBOOK },
    { name: 'xl/_rels/workbook.xml.rels', text: WORKBOOK_RELS },
    { name: 'xl/styles.xml', text: STYLES },
    { name: 'xl/worksheets/sheet1.xml', text: sheet },
  ]);
}

/**
 * Writes one data cell.
 * @param value The cell.
 * @returns Returns its XML.
 */
function valueCell(value: DatabaseValue): string {
  if (value === null) {
    return '<c/>';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? `<c><v>${value}</v></c>` : stringCell(String(value));
  }
  if (typeof value === 'boolean') {
    return `<c t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  return stringCell(cellText(value).text);
}

/**
 * Writes one inline-string cell.
 * @param text The text.
 * @param style The style index, when not the default.
 * @returns Returns its XML.
 */
function stringCell(text: string, style?: number): string {
  const styled: string = style === undefined ? '' : ` s="${style}"`;
  return `<c t="inlineStr"${styled}><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

/**
 * Escapes text for XML, dropping the control characters XML 1.0 cannot hold at all.
 * @param text The text.
 * @returns Returns it escaped.
 */
function escapeXml(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
  );
}

const XML_HEAD: string = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN_NS: string = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS: string = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS: string = 'http://schemas.openxmlformats.org/package/2006/relationships';

const CONTENT_TYPES: string =
  `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  '</Types>';

const ROOT_RELS: string =
  `${XML_HEAD}<Relationships xmlns="${PKG_REL_NS}">` +
  `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>` +
  '</Relationships>';

const WORKBOOK: string =
  `${XML_HEAD}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
  '<sheets><sheet name="Results" sheetId="1" r:id="rId1"/></sheets></workbook>';

const WORKBOOK_RELS: string =
  `${XML_HEAD}<Relationships xmlns="${PKG_REL_NS}">` +
  `<Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="${REL_NS}/styles" Target="styles.xml"/>` +
  '</Relationships>';

const STYLES: string =
  `${XML_HEAD}<styleSheet xmlns="${MAIN_NS}">` +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/**
 * One file going into a zip.
 */
interface ZipEntry {
  readonly name: string;
  readonly text: string;
}

/**
 * Builds a zip archive of text files, each deflated.
 * @param entries The files.
 * @returns Returns a promise resolving the archive's bytes.
 */
async function zip(entries: readonly ZipEntry[]): Promise<Uint8Array> {
  const encoder: TextEncoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset: number = 0;
  for (const entry of entries) {
    const name: Uint8Array = encoder.encode(entry.name);
    const data: Uint8Array = encoder.encode(entry.text);
    const deflated: Uint8Array = await deflateRaw(data);
    const crc: number = crc32(data);
    const local: DataView = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 8, true);
    local.setUint16(10, 0, true);
    local.setUint16(12, 0x21, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, deflated.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, deflated);
    const record: DataView = new DataView(new ArrayBuffer(46));
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(4, 20, true);
    record.setUint16(6, 20, true);
    record.setUint16(8, 0x0800, true);
    record.setUint16(10, 8, true);
    record.setUint16(12, 0, true);
    record.setUint16(14, 0x21, true);
    record.setUint32(16, crc, true);
    record.setUint32(20, deflated.length, true);
    record.setUint32(24, data.length, true);
    record.setUint16(28, name.length, true);
    record.setUint32(42, offset, true);
    central.push(new Uint8Array(record.buffer), name);
    offset += 30 + name.length + deflated.length;
  }
  const centralSize: number = central.reduce(
    (total: number, part: Uint8Array) => total + part.length,
    0,
  );
  const end: DataView = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return concat([...parts, ...central, new Uint8Array(end.buffer)]);
}

/**
 * Deflates bytes with the platform's own compressor.
 * @param data The bytes.
 * @returns Returns a promise resolving the raw deflate stream.
 */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream: ReadableStream<Uint8Array> = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Joins byte arrays.
 * @param parts The arrays.
 * @returns Returns them end to end.
 */
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out: Uint8Array = new Uint8Array(
    parts.reduce((total: number, part: Uint8Array): number => total + part.length, 0),
  );
  let at: number = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * The CRC-32 table, built once.
 */
const CRC_TABLE: Uint32Array = ((): Uint32Array => {
  const table: Uint32Array = new Uint32Array(256);
  for (let n: number = 0; n < 256; n += 1) {
    let c: number = n;
    for (let k: number = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * Computes the CRC-32 a zip records for each file.
 * @param data The bytes.
 * @returns Returns the checksum.
 */
function crc32(data: Uint8Array): number {
  let crc: number = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
