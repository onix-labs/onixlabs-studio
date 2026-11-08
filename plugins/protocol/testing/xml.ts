// A small XML reader for the reports test tools write — JUnit XML and TRX (#1351).
//
// Not a general XML parser: no DTDs, no entity declarations, no validation. It reads well-formed
// elements, attributes, text and CDATA, decodes the five predefined entities and character references,
// and drops a namespace prefix from a name, which is everything those reports use. A plugin bundles it so
// it needs no dependency.

/**
 * Describes one element.
 */
export interface XmlElement {
  /**
   * Gets the element's local name, without a namespace prefix.
   */
  readonly name: string;

  /**
   * Gets its attributes by local name.
   */
  readonly attributes: Readonly<Record<string, string>>;

  /**
   * Gets its child elements, in order.
   */
  readonly children: readonly XmlElement[];

  /**
   * Gets its text and CDATA content, concatenated.
   */
  readonly text: string;
}

/**
 * A mutable element while it is being read.
 */
interface Building {
  readonly name: string;
  readonly attributes: Record<string, string>;
  readonly children: XmlElement[];
  text: string;
}

/**
 * Drops a namespace prefix.
 * @param name The qualified name.
 * @returns Returns the local name.
 */
function localName(name: string): string {
  const colon: number = name.indexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
}

/**
 * Decodes the predefined entities and character references.
 * @param text The raw text.
 * @returns Returns the decoded text.
 */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g,
    (_match: string, entity: string): string => {
      switch (entity) {
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'amp':
          return '&';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        default: {
          const code: number =
            entity[1] === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
          return Number.isFinite(code) && code > 0 && code <= 0x10ffff
            ? String.fromCodePoint(code)
            : '';
        }
      }
    },
  );
}

/**
 * Reads an element's attributes.
 * @param source The text between the name and the closing bracket.
 * @returns Returns the attributes by local name.
 */
function readAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern: RegExp = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null = pattern.exec(source);
  while (match !== null) {
    attributes[localName(match[1])] = decodeEntities(match[3] ?? match[4] ?? '');
    match = pattern.exec(source);
  }
  return attributes;
}

/**
 * Reads a document's root element.
 * @param source The document.
 * @returns Returns the root element, or null when the document holds none or is not well formed.
 */
export function parseXml(source: string): XmlElement | null {
  const stack: Building[] = [];
  let root: XmlElement | null = null;
  let index: number = 0;
  while (index < source.length) {
    const open: number = source.indexOf('<', index);
    const text: string = source.slice(index, open < 0 ? source.length : open);
    if (stack.length > 0 && text.length > 0) {
      stack[stack.length - 1].text += decodeEntities(text);
    }
    if (open < 0) {
      break;
    }
    if (source.startsWith('<!--', open)) {
      const end: number = source.indexOf('-->', open + 4);
      index = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', open)) {
      const end: number = source.indexOf(']]>', open + 9);
      if (stack.length > 0) {
        stack[stack.length - 1].text += source.slice(open + 9, end < 0 ? source.length : end);
      }
      index = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<?', open) || source.startsWith('<!', open)) {
      const end: number = source.indexOf('>', open);
      index = end < 0 ? source.length : end + 1;
      continue;
    }
    const close: number = findTagEnd(source, open);
    if (close < 0) {
      return null;
    }
    const tag: string = source.slice(open + 1, close);
    index = close + 1;
    if (tag.startsWith('/')) {
      const finished: Building | undefined = stack.pop();
      if (finished?.name !== localName(tag.slice(1).trim())) {
        return null;
      }
      const element: XmlElement = finished;
      if (stack.length === 0) {
        root = element;
      } else {
        stack[stack.length - 1].children.push(element);
      }
      continue;
    }
    const selfClosing: boolean = tag.endsWith('/');
    const body: string = selfClosing ? tag.slice(0, -1) : tag;
    const nameEnd: number = body.search(/[\s]/);
    const name: string = localName(nameEnd < 0 ? body : body.slice(0, nameEnd));
    const element: Building = {
      name,
      attributes: nameEnd < 0 ? {} : readAttributes(body.slice(nameEnd)),
      children: [],
      text: '',
    };
    if (selfClosing) {
      if (stack.length === 0) {
        root = element;
      } else {
        stack[stack.length - 1].children.push(element);
      }
    } else {
      stack.push(element);
    }
  }
  return stack.length === 0 ? root : null;
}

/**
 * Finds the `>` that ends a tag, skipping any inside a quoted attribute value.
 * @param source The document.
 * @param open The index of the tag's `<`.
 * @returns Returns the index of its `>`, or -1 when it has none.
 */
function findTagEnd(source: string, open: number): number {
  let quote: string | null = null;
  for (let index: number = open + 1; index < source.length; index += 1) {
    const char: string = source[index];
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return index;
    }
  }
  return -1;
}

/**
 * Finds every descendant element with a name, depth first.
 * @param element The element to search under.
 * @param name The local name.
 * @returns Returns the matches, in document order.
 */
export function descendants(element: XmlElement, name: string): readonly XmlElement[] {
  const found: XmlElement[] = [];
  const visit: (node: XmlElement) => void = (node: XmlElement): void => {
    for (const child of node.children) {
      if (child.name === name) {
        found.push(child);
      }
      visit(child);
    }
  };
  visit(element);
  return found;
}

/**
 * Finds an element's first child with a name.
 * @param element The element.
 * @param name The local name.
 * @returns Returns the child, or undefined when there is none.
 */
export function child(element: XmlElement, name: string): XmlElement | undefined {
  return element.children.find((candidate: XmlElement): boolean => candidate.name === name);
}
