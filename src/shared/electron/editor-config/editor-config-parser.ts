/**
 * Describes one `[section]` of an `.editorconfig`.
 */
export interface EditorConfigSection {
  /**
   * Gets the section's glob.
   */
  readonly glob: string;

  /**
   * Gets the section's properties, with lower-case names.
   */
  readonly properties: ReadonlyMap<string, string>;
}

/**
 * Describes a parsed `.editorconfig`.
 */
export interface EditorConfigFile {
  /**
   * Gets whether the walk up the folders stops at this file.
   */
  readonly root: boolean;

  /**
   * Gets the sections, in file order: a later match wins.
   */
  readonly sections: readonly EditorConfigSection[];
}

/**
 * Parses an `.editorconfig`. Lines that are not understood are skipped, as the specification asks: a
 * file with a typo still means everything else it says. Comments are whole lines only, so `#` and `;`
 * inside a value or a section name are ordinary characters.
 * @param text The file's text.
 * @returns Returns the parsed file.
 */
export function parseEditorConfig(text: string): EditorConfigFile {
  let root: boolean = false;
  const sections: EditorConfigSection[] = [];
  let current: Map<string, string> | null = null;
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    const line: string = raw.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith(';')) {
      continue;
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      current = new Map<string, string>();
      sections.push({ glob: line.slice(1, -1), properties: current });
      continue;
    }
    const separator: number = line.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const name: string = line.slice(0, separator).trim().toLowerCase();
    const value: string = line.slice(separator + 1).trim();
    if (current !== null) {
      current.set(name, value);
    } else if (name === 'root') {
      root = value.toLowerCase() === 'true';
    }
  }
  return { root, sections };
}
