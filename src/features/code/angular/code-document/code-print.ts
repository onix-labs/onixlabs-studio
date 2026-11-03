/**
 * Describes one syntax token of a line, as Monaco's tokenizer reports it: where it starts in the line
 * and its token type, such as `keyword.ts` or `comment.doc.ts`.
 */
export interface CodePrintToken {
  /**
   * Gets the column the token starts at, counted from zero.
   */
  readonly offset: number;

  /**
   * Gets the token type.
   */
  readonly type: string;
}

/**
 * Describes what the print mirror of a code document shows.
 */
export interface CodePrintOptions {
  /**
   * Gets each line's syntax tokens, in line order, or null to print the code uncoloured.
   */
  readonly tokens: readonly (readonly CodePrintToken[])[] | null;

  /**
   * Gets a value indicating whether each line is numbered.
   */
  readonly lineNumbers: boolean;
}

/**
 * Holds the token kinds the print palette colours, matched in order against the start of a token
 * type; the first match wins, so the more specific prefixes come first.
 */
const TOKEN_KINDS: readonly (readonly [prefix: string, kind: string])[] = [
  ['comment', 'comment'],
  ['attribute.value', 'string'],
  ['attribute', 'attribute'],
  ['keyword', 'keyword'],
  ['storage', 'keyword'],
  ['string', 'string'],
  ['number', 'number'],
  ['regexp', 'regexp'],
  ['type', 'type'],
  ['class', 'type'],
  ['metatag', 'tag'],
  ['tag', 'tag'],
  ['variable', 'variable'],
  ['constant', 'variable'],
  ['key', 'variable'],
  ['annotation', 'annotation'],
];

/**
 * Resolves the print palette class for a token type, or null for a token printed in the text colour
 * (identifiers, delimiters, operators, white space).
 * @param type The Monaco token type, such as `keyword.ts`.
 * @returns Returns the class name, or null.
 */
export function tokenClass(type: string): string | null {
  for (const [prefix, kind] of TOKEN_KINDS) {
    if (type === prefix || type.startsWith(`${prefix}.`)) {
      return `code-print__token--${kind}`;
    }
  }
  return null;
}

/**
 * Renders a code document's full text into its print mirror, replacing whatever the mirror held. The
 * mirror is built from text nodes and spans, never parsed markup, so the document's text cannot be
 * read as HTML.
 * @param target The mirror element.
 * @param content The document's text.
 * @param options What the mirror shows.
 */
export function renderCodePrint(
  target: HTMLElement,
  content: string,
  options: CodePrintOptions,
): void {
  const ownerDocument: Document = target.ownerDocument;
  const lines: readonly string[] = content.split(/\r\n|\r|\n/);
  const fragment: DocumentFragment = ownerDocument.createDocumentFragment();
  lines.forEach((line: string, index: number): void => {
    const lineTokens: readonly CodePrintToken[] = options.tokens?.[index] ?? [];
    if (options.lineNumbers) {
      const lineElement: HTMLSpanElement = ownerDocument.createElement('span');
      lineElement.className = 'code-print__line';
      const number: HTMLSpanElement = ownerDocument.createElement('span');
      number.className = 'code-print__number';
      number.textContent = String(index + 1);
      lineElement.append(number, ...lineNodes(ownerDocument, line, lineTokens));
      fragment.append(lineElement);
    } else {
      fragment.append(...lineNodes(ownerDocument, line, lineTokens));
      if (index < lines.length - 1) {
        fragment.append('\n');
      }
    }
  });
  target.classList.toggle('code-print--numbered', options.lineNumbers);
  target.style.setProperty('--code-print-gutter', String(String(lines.length).length));
  target.replaceChildren(fragment);
}

/**
 * Builds the nodes of one line: a coloured span for each token the palette colours, and plain text
 * for the rest.
 * @param ownerDocument The document the nodes are created in.
 * @param line The line's text.
 * @param tokens The line's tokens, in column order.
 * @returns Returns the line's nodes.
 */
function lineNodes(
  ownerDocument: Document,
  line: string,
  tokens: readonly CodePrintToken[],
): (Node | string)[] {
  if (tokens.length === 0) {
    return line.length > 0 ? [line] : [];
  }
  const nodes: (Node | string)[] = [];
  // Text before the first token (a tokenizer always starts at zero, but this keeps a malformed list
  // from dropping text) prints plain.
  if (tokens[0].offset > 0) {
    nodes.push(line.slice(0, tokens[0].offset));
  }
  tokens.forEach((token: CodePrintToken, index: number): void => {
    const text: string = line.slice(token.offset, tokens[index + 1]?.offset ?? line.length);
    if (text.length === 0) {
      return;
    }
    const className: string | null = tokenClass(token.type);
    if (className === null) {
      nodes.push(text);
      return;
    }
    const span: HTMLSpanElement = ownerDocument.createElement('span');
    span.className = className;
    span.textContent = text;
    nodes.push(span);
  });
  return nodes;
}
