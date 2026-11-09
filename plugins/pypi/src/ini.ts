// A minimal reader for the INI files Python's own `configparser` reads: `pip.conf` / `pip.ini` and
// `setup.cfg`. Only what those two use: `[section]` headers, `key = value` or `key: value`, values
// continued on indented lines, and whole-line `#` / `;` comments. `configparser` keeps a `#` inside a
// value as part of it, and so does this.

/**
 * An INI document: its sections by name, each its keys by name. Keys are lower-cased, as
 * `configparser` does.
 */
export type IniDocument = ReadonlyMap<string, ReadonlyMap<string, string>>;

/**
 * Reads an INI document. Never throws: a line it cannot read is skipped, as a stray line in a config
 * should not cost the rest of it.
 * @param text The document.
 * @returns Returns its sections.
 */
export function parseIni(text: string): IniDocument {
  const sections: Map<string, Map<string, string>> = new Map<string, Map<string, string>>();
  let section: Map<string, string> | null = null;
  let key: string | null = null;
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const trimmed: string = raw.trim();
    if (trimmed.length === 0) {
      // A blank line inside a continued value is kept by `configparser`; it ends nothing that matters
      // here, since every value read is a list of lines with the blank ones dropped.
      continue;
    }
    if (trimmed.startsWith('#') || trimmed.startsWith(';')) {
      continue;
    }
    if (/^\s/.test(raw) && section !== null && key !== null) {
      section.set(key, `${section.get(key) ?? ''}\n${trimmed}`);
      continue;
    }
    const header: RegExpExecArray | null = /^\[([^\]]+)\]$/.exec(trimmed);
    if (header !== null) {
      const name: string = header[1].trim();
      section = sections.get(name) ?? new Map<string, string>();
      sections.set(name, section);
      key = null;
      continue;
    }
    const pair: RegExpExecArray | null = /^([^=:]+?)\s*[=:]\s*(.*)$/.exec(trimmed);
    if (pair === null || section === null) {
      key = null;
      continue;
    }
    key = pair[1].toLowerCase();
    section.set(key, pair[2]);
  }
  return sections;
}

/**
 * Splits a value into its non-empty lines, trimmed: how `setup.cfg` lists requirements, one per line.
 * @param value The value, or undefined when the key is absent.
 * @returns Returns the lines.
 */
export function valueLines(value: string | undefined): readonly string[] {
  return (value ?? '')
    .split('\n')
    .map((line: string): string => line.trim())
    .filter((line: string): boolean => line.length > 0);
}
