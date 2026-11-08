// A minimal XML reader: enough for a POM, `settings.xml` and a repository's `maven-metadata.xml`.
//
// Those are plain element trees — no mixed content that matters, no namespaces worth keeping, no
// entities beyond the five predefined ones and character references — and a regular-expression scan of
// a POM cannot tell `<dependencies>` under `<project>` from the ones under a plugin or a profile. So
// this builds a tree, and the readers walk it by element name.
//
// ⛔ A DOCTYPE is skipped, never read: an internal subset's entities are not expanded, so a hostile file
// cannot make this plugin read another file or expand itself into gigabytes.

/**
 * One element of a document.
 */
export interface XmlElement {
  /**
   * Gets the element's local name, without any namespace prefix.
   */
  readonly name: string;

  /**
   * Gets the element's attributes, by local name.
   */
  readonly attributes: Readonly<Record<string, string>>;

  /**
   * Gets the child elements, in document order.
   */
  readonly children: readonly XmlElement[];

  /**
   * Gets the element's own text (character data and CDATA, entities decoded), untrimmed.
   */
  readonly text: string;
}

/**
 * An element while the document is still being read.
 */
interface OpenElement {
  /**
   * Gets the local name.
   */
  readonly name: string;

  /**
   * Gets the attributes.
   */
  readonly attributes: Record<string, string>;

  /**
   * Gets the children read so far.
   */
  readonly children: XmlElement[];

  /**
   * Gets the text read so far.
   */
  text: string;
}

/**
 * The predefined entities, the only named ones XML has without a DTD.
 */
const ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

/**
 * Decodes the predefined entities and character references in text. An unknown entity is left as it is
 * rather than guessed at.
 * @param value The raw text.
 * @returns Returns the decoded text.
 */
export function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g,
    (match: string, entity: string): string => {
      if (entity.startsWith('#x')) {
        return codePoint(Number.parseInt(entity.slice(2), 16), match);
      }
      if (entity.startsWith('#')) {
        return codePoint(Number.parseInt(entity.slice(1), 10), match);
      }
      return ENTITIES[entity] ?? match;
    },
  );
}

/**
 * Turns a character reference's number into its character, keeping the reference when it names none.
 * @param value The code point.
 * @param fallback The reference as written.
 * @returns Returns the character.
 */
function codePoint(value: number, fallback: string): string {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : fallback;
}

/**
 * Drops a namespace prefix: `m:project` is read as `project`.
 * @param name The qualified name.
 * @returns Returns the local name.
 */
function localName(name: string): string {
  const colon: number = name.indexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
}

/**
 * Reads a tag's attributes.
 * @param source The text between the tag's name and its closing `>`.
 * @returns Returns the attributes, by local name.
 */
function readAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[localName(match[1])] = decodeEntities(match[2] ?? match[3] ?? '');
  }
  return attributes;
}

/**
 * Seals an open element into the tree's shape.
 * @param open The open element.
 * @returns Returns the element.
 */
function seal(open: OpenElement): XmlElement {
  return {
    name: open.name,
    attributes: open.attributes,
    children: open.children,
    text: open.text,
  };
}

/**
 * Reads a document into its root element. Forgiving, because the files are hand-written: an end tag
 * with no matching start is ignored, and elements left open at the end are closed there.
 * @param source The document.
 * @returns Returns the root element, or null when the document has none.
 */
export function parseXml(source: string): XmlElement | null {
  const stack: OpenElement[] = [];
  const roots: XmlElement[] = [];
  let index: number = 0;
  const close: () => void = (): void => {
    const done: OpenElement | undefined = stack.pop();
    if (done === undefined) {
      return;
    }
    const element: XmlElement = seal(done);
    const parent: OpenElement | undefined = stack.at(-1);
    if (parent === undefined) {
      roots.push(element);
    } else {
      parent.children.push(element);
    }
  };
  while (index < source.length) {
    const open: number = source.indexOf('<', index);
    const textEnd: number = open < 0 ? source.length : open;
    const top: OpenElement | undefined = stack.at(-1);
    if (top !== undefined && textEnd > index) {
      top.text += decodeEntities(source.slice(index, textEnd));
    }
    if (open < 0) {
      break;
    }
    if (source.startsWith('<!--', open)) {
      index = skipPast(source, open, '-->');
    } else if (source.startsWith('<![CDATA[', open)) {
      const end: number = source.indexOf(']]>', open);
      const stop: number = end < 0 ? source.length : end;
      if (top !== undefined) {
        top.text += source.slice(open + 9, stop);
      }
      index = end < 0 ? source.length : end + 3;
    } else if (source.startsWith('<?', open)) {
      index = skipPast(source, open, '?>');
    } else if (source.startsWith('<!', open)) {
      index = skipDeclaration(source, open);
    } else if (source.startsWith('</', open)) {
      const end: number = source.indexOf('>', open);
      const name: string = localName(source.slice(open + 2, end < 0 ? undefined : end).trim());
      const depth: number = stack
        .map((element: OpenElement): string => element.name)
        .lastIndexOf(name);
      if (depth >= 0) {
        while (stack.length > depth) {
          close();
        }
      }
      index = end < 0 ? source.length : end + 1;
    } else {
      const end: number = tagEnd(source, open);
      const body: string = source.slice(open + 1, end);
      const selfClosing: boolean = body.endsWith('/');
      const inner: string = selfClosing ? body.slice(0, -1) : body;
      const nameMatch: RegExpExecArray | null = /^[^\s/>]+/.exec(inner);
      if (nameMatch !== null) {
        stack.push({
          name: localName(nameMatch[0]),
          attributes: readAttributes(inner.slice(nameMatch[0].length)),
          children: [],
          text: '',
        });
        if (selfClosing) {
          close();
        }
      }
      index = end + 1;
    }
  }
  while (stack.length > 0) {
    close();
  }
  return roots[0] ?? null;
}

/**
 * Finds the index just past a terminator.
 * @param source The document.
 * @param from Where the construct starts.
 * @param terminator What ends it.
 * @returns Returns the index after the terminator, or the end of the document.
 */
function skipPast(source: string, from: number, terminator: string): number {
  const end: number = source.indexOf(terminator, from);
  return end < 0 ? source.length : end + terminator.length;
}

/**
 * Skips a `<!DOCTYPE …>` or similar declaration, including a bracketed internal subset, without reading
 * any of it.
 * @param source The document.
 * @param from Where the declaration starts.
 * @returns Returns the index after it.
 */
function skipDeclaration(source: string, from: number): number {
  let depth: number = 0;
  for (let index: number = from + 2; index < source.length; index += 1) {
    const character: string = source[index];
    if (character === '[') {
      depth += 1;
    } else if (character === ']') {
      depth -= 1;
    } else if (character === '>' && depth <= 0) {
      return index + 1;
    }
  }
  return source.length;
}

/**
 * Finds the `>` that ends a start tag, stepping over quoted attribute values that may hold one.
 * @param source The document.
 * @param from Where the tag starts.
 * @returns Returns the index of the `>`, or the last index of the document.
 */
function tagEnd(source: string, from: number): number {
  let quote: string | null = null;
  for (let index: number = from + 1; index < source.length; index += 1) {
    const character: string = source[index];
    if (quote !== null) {
      if (character === quote) {
        quote = null;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return source.length - 1;
}

/**
 * Finds an element's first child of a name.
 * @param element The element, or null.
 * @param name The child's local name.
 * @returns Returns the child, or null.
 */
export function child(element: XmlElement | null, name: string): XmlElement | null {
  return (
    element?.children.find((candidate: XmlElement): boolean => candidate.name === name) ?? null
  );
}

/**
 * Finds an element's children of a name.
 * @param element The element, or null.
 * @param name The children's local name.
 * @returns Returns the children, in document order.
 */
export function children(element: XmlElement | null, name: string): readonly XmlElement[] {
  return (
    element?.children.filter((candidate: XmlElement): boolean => candidate.name === name) ?? []
  );
}

/**
 * Follows a path of child names, such as `dependencyManagement/dependencies`.
 * @param element The element to start from, or null.
 * @param route The child names, separated by `/`.
 * @returns Returns the element at the end of the path, or null.
 */
export function descend(element: XmlElement | null, route: string): XmlElement | null {
  let current: XmlElement | null = element;
  for (const name of route.split('/')) {
    current = child(current, name);
  }
  return current;
}

/**
 * Reads a child's trimmed text.
 * @param element The element, or null.
 * @param name The child's local name.
 * @returns Returns the text, or null when the child is absent or empty.
 */
export function childText(element: XmlElement | null, name: string): string | null {
  const text: string | undefined = child(element, name)?.text.trim();
  return text === undefined || text.length === 0 ? null : text;
}
