/**
 * A well-formedness problem found in XML text: what is wrong and where.
 */
export interface XmlProblem {
  /**
   * Gets the description of the problem.
   */
  readonly message: string;

  /**
   * Gets the one-based line the problem is on.
   */
  readonly line: number;

  /**
   * Gets the one-based column the problem is at.
   */
  readonly column: number;
}

/**
 * Finds the first well-formedness problem in XML text, using the platform's XML parser. Monaco has
 * an XML grammar but no XML language service, so a field editing XML gets its errors from the
 * browser's parser instead: it stops at the first problem, which is reported with its position.
 * Blank text is not a problem — an empty body is a choice, not a mistake.
 * @param text The XML text.
 * @param parser The parser to use; defaults to the platform's.
 * @returns Returns the first problem, or null when the text is well-formed or blank.
 */
export function findXmlProblem(
  text: string,
  parser: DOMParser = new DOMParser(),
): XmlProblem | null {
  if (text.trim().length === 0) {
    return null;
  }
  let document: Document;
  try {
    document = parser.parseFromString(text, 'application/xml');
  } catch (error: unknown) {
    return { message: error instanceof Error ? error.message : String(error), line: 1, column: 1 };
  }
  const error: Element | undefined = document.getElementsByTagName('parsererror')[0];
  if (error === undefined) {
    return null;
  }
  return parseParserError(error.textContent ?? '');
}

/**
 * Reads a problem out of the text of a `parsererror` element. Chromium writes `error on line L at
 * column C: message` inside a page of boilerplate; other parsers lead with `L:C:`. Anything else is
 * reported at the start of the text with its first line as the message.
 * @param text The parser error text.
 * @returns Returns the problem.
 */
export function parseParserError(text: string): XmlProblem {
  const chromium: RegExpExecArray | null = /line (\d+) at column (\d+): ([^\n]*)/.exec(text);
  if (chromium !== null) {
    return {
      line: Number(chromium[1]),
      column: Number(chromium[2]),
      message: chromium[3].trim(),
    };
  }
  const prefixed: RegExpExecArray | null = /^\s*(\d+):(\d+):\s*([^\n]*)/.exec(text);
  if (prefixed !== null) {
    return {
      line: Number(prefixed[1]),
      column: Number(prefixed[2]),
      message: prefixed[3].trim(),
    };
  }
  const firstLine: string = text.split('\n', 1)[0].trim();
  return {
    line: 1,
    column: 1,
    message: firstLine.length > 0 ? firstLine : 'The XML is not well-formed.',
  };
}
