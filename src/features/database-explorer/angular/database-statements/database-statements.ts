/**
 * One statement of a query's text, with where it sits.
 */
export interface StatementSpan {
  /**
   * Gets the statement's text, without its terminating semicolon.
   */
  readonly text: string;

  /**
   * Gets the 1-based document line its first character sits on.
   */
  readonly line: number;

  /**
   * Gets the offset its region starts at, just past the semicolon before it.
   */
  readonly start: number;

  /**
   * Gets the offset its region ends at, just past its own semicolon.
   */
  readonly end: number;

  /**
   * Gets its text with every comment and string blanked out, so a keyword found in it is one.
   */
  readonly code: string;
}

/**
 * Cuts a query's text into statements at the semicolons that end them: outside quotes, identifiers,
 * comments and dollar-quoted bodies, and outside a `CREATE TRIGGER … BEGIN … END` block. It follows the
 * same rules as the splitter engines run a script with, and keeps what the editor needs and the engines
 * do not: each statement's offsets, and its text with the comments and strings out of the way.
 * @param script The text.
 * @param slashComments Whether `//` starts a line comment, as it does in Cypher but not in SQL.
 * @returns Returns the statements, in order, leaving out any that hold nothing to run.
 */
export function statementSpans(
  script: string,
  slashComments: boolean = false,
): readonly StatementSpan[] {
  const spans: StatementSpan[] = [];
  let start: number = 0;
  let index: number = 0;
  let depth: number = 0;
  let code: string = '';

  const push: (end: number) => void = (end: number): void => {
    const raw: string = script.slice(start, end);
    const lead: number = code.length - code.trimStart().length;
    if (code.trim() !== '') {
      spans.push({
        text: raw.slice(lead).trimEnd().replace(/;$/, '').trimEnd(),
        line: script.slice(0, start + lead).split('\n').length,
        start,
        end,
        code: code.trim(),
      });
    }
    start = end;
    code = '';
  };
  const blank: (stop: number) => void = (stop: number): void => {
    code += script.slice(index, stop).replace(/[^\n]/g, ' ');
    index = stop;
  };

  while (index < script.length) {
    const char: string = script[index];
    const next: string = script[index + 1] ?? '';
    if ((char === '-' && next === '-') || (slashComments && char === '/' && next === '/')) {
      const end: number = script.indexOf('\n', index);
      blank(end === -1 ? script.length : end);
    } else if (char === '/' && next === '*') {
      const end: number = script.indexOf('*/', index + 2);
      blank(end === -1 ? script.length : end + 2);
    } else if (char === "'" || char === '"' || char === '`' || char === '[') {
      blank(quotedEnd(script, index, char === '[' ? ']' : char));
    } else if (char === '$' && /^\$[A-Za-z_]*\$/.test(script.slice(index))) {
      const tag: string = /^\$[A-Za-z_]*\$/.exec(script.slice(index))?.[0] ?? '$$';
      const end: number = script.indexOf(tag, index + tag.length);
      blank(end === -1 ? script.length : end + tag.length);
    } else if (/[A-Za-z_]/.test(char)) {
      const word: string = /^\w+/.exec(script.slice(index))?.[0] ?? char;
      const upper: string = word.toUpperCase();
      if (upper === 'BEGIN' && /^\s*CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(code)) {
        depth += 1;
      } else if (upper === 'END' && depth > 0) {
        depth -= 1;
      }
      code += word;
      index += word.length;
    } else if (char === ';' && depth === 0) {
      index += 1;
      push(index);
    } else {
      code += char;
      index += 1;
    }
  }
  push(script.length);
  return spans;
}

/**
 * Finds where a quoted run ends, a doubled closing quote being part of it.
 * @param script The text.
 * @param from The opening quote's offset.
 * @param close The closing quote.
 * @returns Returns the offset just past it.
 */
function quotedEnd(script: string, from: number, close: string): number {
  let cursor: number = from + 1;
  while (cursor < script.length) {
    if (script[cursor] === close) {
      if (close !== ']' && script[cursor + 1] === close) {
        cursor += 2;
        continue;
      }
      return cursor + 1;
    }
    cursor += 1;
  }
  return script.length;
}

/**
 * Finds the statement the caret is in: the one whose region holds it, or for a caret in the blank space
 * after the last, that last one.
 * @param script The text.
 * @param offset The caret's offset.
 * @param slashComments Whether `//` starts a line comment.
 * @returns Returns the statement, or undefined when the text holds none.
 */
export function statementAt(
  script: string,
  offset: number,
  slashComments: boolean = false,
): StatementSpan | undefined {
  const spans: readonly StatementSpan[] = statementSpans(script, slashComments);
  return spans.find((span: StatementSpan): boolean => offset < span.end) ?? spans[spans.length - 1];
}

/**
 * Lists the statements in some text that cannot be taken back: a DROP or TRUNCATE, or a DELETE or
 * UPDATE with no WHERE. Cypher has no statement that starts with DELETE, so there any DELETE without a
 * WHERE counts.
 * @param script The text.
 * @param language The language it is written in.
 * @returns Returns the statements' text, in order.
 */
export function destructiveStatements(script: string, language: string): readonly string[] {
  const cypher: boolean = language === 'cypher';
  return statementSpans(script, cypher)
    .filter((span: StatementSpan): boolean => isDestructive(span.code, cypher))
    .map((span: StatementSpan): string => span.text);
}

/**
 * Determines whether a statement cannot be taken back.
 * @param code The statement, its comments and strings blanked out.
 * @param cypher Whether it is Cypher.
 * @returns Returns true when it is destructive.
 */
function isDestructive(code: string, cypher: boolean): boolean {
  if (/^(DROP|TRUNCATE)\b/i.test(code)) {
    return true;
  }
  if (/\bWHERE\b/i.test(code)) {
    return false;
  }
  return cypher ? /\bDELETE\b/i.test(code) : /^(WITH\b.*\b)?(DELETE|UPDATE)\b/is.test(code);
}
