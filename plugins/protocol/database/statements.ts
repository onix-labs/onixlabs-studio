/**
 * One statement cut out of a script, with the document line it starts on.
 */
export interface ScriptStatement {
  /**
   * Gets the statement's text, without its terminating semicolon.
   */
  readonly text: string;

  /**
   * Gets the 1-based line the statement's first character sits on, in the caller's numbering.
   */
  readonly line: number;
}

/**
 * Splits a script into statements at the semicolons that end them, so each one runs on its own and an
 * error is reported against the statement — and the line — it came from.
 *
 * A semicolon only ends a statement outside quotes, identifiers, comments and dollar-quoted bodies
 * (PostgreSQL's `$$ … $$` and `$tag$ … $tag$`), and outside a `CREATE TRIGGER … BEGIN … END` block,
 * whose body is itself a list of statements. That is deliberately all it knows: it is a splitter, not a
 * parser, and anything it gets wrong the database will say so about.
 * @param script The script to split.
 * @param firstLine The line the script starts on in the document, 1-based.
 * @param slashComments Whether `//` starts a line comment, as it does in Cypher but not in SQL.
 * @returns Returns the non-empty statements, in order.
 */
export function splitStatements(
  script: string,
  firstLine: number = 1,
  slashComments: boolean = false,
): readonly ScriptStatement[] {
  const statements: ScriptStatement[] = [];
  let start: number = 0;
  let index: number = 0;
  let line: number = firstLine;
  let startLine: number = firstLine;
  let blockDepth: number = 0;

  const push: (end: number) => void = (end: number): void => {
    const raw: string = script.slice(start, end);
    const text: string = raw.trim();
    if (text !== '' && !isOnlyComments(text, slashComments)) {
      // The statement's line is that of its first token, not of a comment above it, so an error is
      // reported where the statement actually is.
      const leading: RegExp = slashComments
        ? /^(\s|--[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/
        : /^(\s|--[^\n]*|\/\*[\s\S]*?\*\/)*/;
      const skipped: string = leading.exec(raw)?.[0] ?? '';
      statements.push({ text, line: startLine + countNewlines(skipped) });
    }
  };

  while (index < script.length) {
    const char: string = script[index];
    const next: string = script[index + 1] ?? '';

    if (char === '\n') {
      line += 1;
      index += 1;
      continue;
    }
    if ((char === '-' && next === '-') || (slashComments && char === '/' && next === '/')) {
      const end: number = script.indexOf('\n', index);
      index = end === -1 ? script.length : end;
      continue;
    }
    if (char === '/' && next === '*') {
      const end: number = script.indexOf('*/', index + 2);
      const stop: number = end === -1 ? script.length : end + 2;
      line += countNewlines(script.slice(index, stop));
      index = stop;
      continue;
    }
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      const close: string = char === '[' ? ']' : char;
      let cursor: number = index + 1;
      while (cursor < script.length) {
        if (script[cursor] === close) {
          if (close !== ']' && script[cursor + 1] === close) {
            cursor += 2;
            continue;
          }
          break;
        }
        cursor += 1;
      }
      const stop: number = Math.min(cursor + 1, script.length);
      line += countNewlines(script.slice(index, stop));
      index = stop;
      continue;
    }
    if (char === '$') {
      const tag: RegExpExecArray | null = /^\$[A-Za-z_]*\$/.exec(script.slice(index));
      if (tag !== null) {
        const end: number = script.indexOf(tag[0], index + tag[0].length);
        const stop: number = end === -1 ? script.length : end + tag[0].length;
        line += countNewlines(script.slice(index, stop));
        index = stop;
        continue;
      }
    }
    if (/[A-Za-z]/.test(char) && (index === 0 || !/[\w$]/.test(script[index - 1]))) {
      const word: string = /^[A-Za-z_]+/.exec(script.slice(index))?.[0] ?? char;
      const upper: string = word.toUpperCase();
      if (upper === 'BEGIN' && isTriggerBody(script.slice(start, index))) {
        blockDepth += 1;
      } else if (upper === 'END' && blockDepth > 0) {
        blockDepth -= 1;
      }
      index += word.length;
      continue;
    }
    if (char === ';' && blockDepth === 0) {
      push(index);
      index += 1;
      start = index;
      startLine = line;
      continue;
    }
    index += 1;
  }
  push(script.length);
  return statements;
}

/**
 * Counts the line breaks in some text.
 * @param text The text to count in.
 * @returns Returns the number of `\n` characters.
 */
export function countNewlines(text: string): number {
  let count: number = 0;
  for (const char of text) {
    if (char === '\n') {
      count += 1;
    }
  }
  return count;
}

/**
 * Determines whether a statement's text so far opens a trigger, whose `BEGIN … END` body holds
 * semicolons that do not end the statement.
 * @param text The statement's text up to the `BEGIN`.
 * @returns Returns true for a `CREATE TRIGGER`.
 */
function isTriggerBody(text: string): boolean {
  return /^\s*CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(text);
}

/**
 * Determines whether a fragment holds nothing but comments, so a trailing comment after the last
 * semicolon is not run as an empty statement.
 * @param text The trimmed fragment.
 * @param slashComments Whether `//` starts a line comment.
 * @returns Returns true when stripping comments leaves nothing.
 */
function isOnlyComments(text: string, slashComments: boolean): boolean {
  return (
    text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(slashComments ? /(--|\/\/)[^\n]*/g : /--[^\n]*/g, '')
      .trim() === ''
  );
}
