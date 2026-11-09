// Readers for the three files a Go module is described by: `go.mod`, `go.work` and `go.sum`.
//
// `go.mod` and `go.work` share one syntax (golang.org/x/mod/modfile): a directive is a verb and its
// arguments on one line, or a verb and `(` opening a block whose every line is one more of that verb,
// closed by `)`. Arguments are bare words or Go string literals ("quoted" or `raw`), and `//` starts a
// comment that runs to the end of the line. That comment matters: `// indirect` after a requirement is
// how go.mod says the main module does not import it itself.
//
// Only what this plugin models is read — `module`, `require`, `replace` and `exclude` from go.mod, `use`
// and `replace` from go.work — and a line that cannot be read is skipped rather than failing the file:
// the go command would refuse it, and the user will hear about it from the go command, not from here.

/**
 * One requirement in a go.mod.
 */
export interface GoRequirement {
  /**
   * Gets the module path.
   */
  readonly path: string;

  /**
   * Gets the version required.
   */
  readonly version: string;

  /**
   * Gets whether the requirement is marked `// indirect`: needed by a dependency, not imported by the
   * module itself.
   */
  readonly indirect: boolean;
}

/**
 * One `replace` directive.
 */
export interface GoReplacement {
  /**
   * Gets the module path replaced.
   */
  readonly path: string;

  /**
   * Gets the one version replaced, or null when every version is.
   */
  readonly version: string | null;

  /**
   * Gets the replacement: a module path, or a directory when {@link GoReplacement.newVersion} is null.
   */
  readonly newPath: string;

  /**
   * Gets the replacement module's version, or null when the replacement is a directory on disk.
   */
  readonly newVersion: string | null;
}

/**
 * One `exclude` directive: a version the go command must never select.
 */
export interface GoExclusion {
  /**
   * Gets the module path.
   */
  readonly path: string;

  /**
   * Gets the version excluded.
   */
  readonly version: string;
}

/**
 * What this plugin reads from a go.mod.
 */
export interface GoModFile {
  /**
   * Gets the module's path, or null when the file declares none.
   */
  readonly module: string | null;

  /**
   * Gets the requirements, in file order.
   */
  readonly requires: readonly GoRequirement[];

  /**
   * Gets the replacements, in file order.
   */
  readonly replaces: readonly GoReplacement[];

  /**
   * Gets the exclusions, in file order.
   */
  readonly excludes: readonly GoExclusion[];
}

/**
 * What this plugin reads from a go.work.
 */
export interface GoWorkFile {
  /**
   * Gets the module directories the workspace uses, as written (relative to the go.work's directory,
   * or absolute).
   */
  readonly uses: readonly string[];

  /**
   * Gets the workspace's replacements, which win over any a module declares.
   */
  readonly replaces: readonly GoReplacement[];
}

/**
 * One line of a go.mod or go.work, broken into its arguments and its trailing comment.
 */
interface Line {
  /**
   * Gets the arguments, with string literals unquoted.
   */
  readonly tokens: readonly string[];

  /**
   * Gets the trailing comment's text without its `//`, trimmed, or null when there is none.
   */
  readonly comment: string | null;
}

/**
 * One directive: its verb and one line's worth of arguments. A block yields one per line inside it.
 */
interface Directive {
  /**
   * Gets the verb (`require`, `replace`, …).
   */
  readonly verb: string;

  /**
   * Gets the arguments after the verb.
   */
  readonly args: readonly string[];

  /**
   * Gets the line's trailing comment, or null.
   */
  readonly comment: string | null;
}

/**
 * Breaks one line into arguments and a trailing comment. `(`, `)` and `=>` are arguments of their own
 * even when written against a word, as the modfile lexer reads them.
 * @param text The line.
 * @returns Returns the line, or null when a string literal on it is never closed.
 */
function lex(text: string): Line | null {
  const tokens: string[] = [];
  let index: number = 0;
  while (index < text.length) {
    const character: string = text[index];
    if (character === ' ' || character === '\t' || character === '\r') {
      index += 1;
    } else if (text.startsWith('//', index)) {
      return { tokens, comment: text.slice(index + 2).trim() };
    } else if (character === '(' || character === ')') {
      tokens.push(character);
      index += 1;
    } else if (text.startsWith('=>', index)) {
      tokens.push('=>');
      index += 2;
    } else if (character === '"' || character === '`') {
      const end: number = closingQuote(text, index);
      if (end < 0) {
        return null;
      }
      tokens.push(unquote(text.slice(index, end + 1)));
      index = end + 1;
    } else {
      let end: number = index;
      while (
        end < text.length &&
        !/[\s()"`]/.test(text[end]) &&
        !text.startsWith('//', end) &&
        !text.startsWith('=>', end)
      ) {
        end += 1;
      }
      tokens.push(text.slice(index, end));
      index = end;
    }
  }
  return { tokens, comment: null };
}

/**
 * Finds where a string literal closes.
 * @param text The line.
 * @param start Where the literal opens.
 * @returns Returns the index of the closing quote, or -1 when it does not close on the line.
 */
function closingQuote(text: string, start: number): number {
  const quote: string = text[start];
  for (let index: number = start + 1; index < text.length; index += 1) {
    if (quote === '"' && text[index] === '\\') {
      index += 1;
    } else if (text[index] === quote) {
      return index;
    }
  }
  return -1;
}

/**
 * Unquotes a string literal. A raw literal is taken as written; an interpreted one has its simple
 * escapes undone, which covers everything a module path or directory can sensibly hold.
 * @param literal The literal, with its quotes.
 * @returns Returns its value.
 */
function unquote(literal: string): string {
  const body: string = literal.slice(1, -1);
  if (literal.startsWith('`')) {
    return body;
  }
  return body.replace(/\\(.)/g, (_whole: string, escaped: string): string =>
    escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped,
  );
}

/**
 * Reads a file's directives, expanding blocks so each entry stands alone with its verb.
 * @param text The file.
 * @returns Returns the directives, in file order.
 */
function directives(text: string): readonly Directive[] {
  const found: Directive[] = [];
  let block: string | null = null;
  for (const raw of text.replace(/^\uFEFF/, '').split('\n')) {
    const line: Line | null = lex(raw);
    if (line === null || line.tokens.length === 0) {
      continue;
    }
    const tokens: readonly string[] = line.tokens;
    if (block !== null) {
      if (tokens[0] === ')') {
        block = null;
      } else {
        found.push({ verb: block, args: tokens, comment: line.comment });
      }
      continue;
    }
    if (tokens[1] === '(') {
      // `require ()` opens and closes on one line, and holds nothing.
      block = tokens[2] === ')' ? null : tokens[0];
      continue;
    }
    found.push({ verb: tokens[0], args: tokens.slice(1), comment: line.comment });
  }
  return found;
}

/**
 * Reads a `replace` directive's arguments: `old [version] => new [version]`.
 * @param args The arguments.
 * @returns Returns the replacement, or null when they are not one.
 */
function readReplacement(args: readonly string[]): GoReplacement | null {
  const arrow: number = args.indexOf('=>');
  if (arrow !== 1 && arrow !== 2) {
    return null;
  }
  const after: readonly string[] = args.slice(arrow + 1);
  if (after.length !== 1 && after.length !== 2) {
    return null;
  }
  return {
    path: args[0],
    version: arrow === 2 ? args[1] : null,
    newPath: after[0],
    newVersion: after.length === 2 ? after[1] : null,
  };
}

/**
 * Determines whether a requirement's comment marks it indirect: `// indirect`, or `// indirect; …`
 * when a note follows, as the go command writes and reads it.
 * @param comment The comment, or null.
 * @returns Returns true when it does.
 */
function isIndirect(comment: string | null): boolean {
  return comment !== null && (comment === 'indirect' || comment.startsWith('indirect;'));
}

/**
 * Reads a go.mod.
 * @param text The file.
 * @returns Returns what it declares.
 */
export function parseGoMod(text: string): GoModFile {
  let module: string | null = null;
  const requires: GoRequirement[] = [];
  const replaces: GoReplacement[] = [];
  const excludes: GoExclusion[] = [];
  for (const directive of directives(text)) {
    const args: readonly string[] = directive.args;
    switch (directive.verb) {
      case 'module':
        if (args.length === 1) {
          module = args[0];
        }
        break;
      case 'require':
        if (args.length === 2) {
          requires.push({
            path: args[0],
            version: args[1],
            indirect: isIndirect(directive.comment),
          });
        }
        break;
      case 'exclude':
        if (args.length === 2) {
          excludes.push({ path: args[0], version: args[1] });
        }
        break;
      case 'replace': {
        const replacement: GoReplacement | null = readReplacement(args);
        if (replacement !== null) {
          replaces.push(replacement);
        }
        break;
      }
      default:
        break;
    }
  }
  return { module, requires, replaces, excludes };
}

/**
 * Reads a go.work.
 * @param text The file.
 * @returns Returns what it declares.
 */
export function parseGoWork(text: string): GoWorkFile {
  const uses: string[] = [];
  const replaces: GoReplacement[] = [];
  for (const directive of directives(text)) {
    if (directive.verb === 'use' && directive.args.length === 1) {
      uses.push(directive.args[0]);
    } else if (directive.verb === 'replace') {
      const replacement: GoReplacement | null = readReplacement(directive.args);
      if (replacement !== null) {
        replaces.push(replacement);
      }
    }
  }
  return { uses, replaces };
}

/**
 * Reads a go.sum into the module versions it holds a checksum for: `path version`, whether the line
 * is the module's code (`h1:` of the zip) or only its go.mod (`version/go.mod`). Either means the
 * version was resolved and recorded; the code-only distinction is not one the panel draws.
 * @param text The file.
 * @returns Returns the recorded versions, as `path@version`.
 */
export function parseGoSum(text: string): ReadonlySet<string> {
  const recorded: Set<string> = new Set<string>();
  for (const line of text.split('\n')) {
    const fields: readonly string[] = line.trim().split(/\s+/);
    // A checksum is an algorithm and a hash: `h1:…`.
    if (fields.length !== 3 || !/^[a-z0-9]+:/.test(fields[2])) {
      continue;
    }
    recorded.add(`${fields[0]}@${fields[1].replace(/\/go\.mod$/, '')}`);
  }
  return recorded;
}
