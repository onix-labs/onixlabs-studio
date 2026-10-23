import {
  IBuffer,
  IBufferCell,
  IBufferCellPosition,
  IBufferLine,
  IBufferRange,
  ILink,
  ILinkProvider,
} from '@xterm/xterm';
import {
  findTerminalPaths,
  findTerminalUrls,
  MAX_LINK_LINE_LENGTH,
  TerminalPathMatch,
  TerminalTextMatch,
  TerminalUrlMatch,
} from './terminal-links';

/**
 * Represents what a terminal link points at: a web address, or a file at a position.
 */
export type TerminalLinkTarget =
  | { readonly kind: 'url'; readonly url: string }
  | {
      readonly kind: 'path';
      readonly path: string;
      readonly line: number | null;
      readonly column: number | null;
    };

/**
 * Represents what the terminal does with its links, which the provider only finds.
 */
export interface TerminalLinkHandlers {
  /**
   * Resolves a printed path to the absolute path of the file it names, or null when no such file is
   * there to open. Null for a terminal that links addresses only.
   */
  readonly resolvePath: ((path: string) => Promise<string | null>) | null;

  /**
   * Called when a link is clicked, whatever was held down; the handler decides whether that opens it.
   */
  activate(event: MouseEvent, target: TerminalLinkTarget): void;

  /**
   * Called when the pointer arrives on a link.
   */
  hover(event: MouseEvent, target: TerminalLinkTarget): void;

  /**
   * Called when the pointer leaves a link.
   */
  leave(): void;
}

/**
 * Represents a line of terminal output as one string, with where each of its characters sits on
 * screen. A line the terminal wrapped across several rows is read as the one line it is.
 */
export interface TerminalLogicalLine {
  /**
   * Gets the line's text.
   */
  readonly text: string;

  /**
   * Gets, for each character of {@link text}, the 1-based cell it is drawn in and how many columns
   * wide it is drawn.
   */
  readonly cells: readonly { readonly x: number; readonly y: number; readonly width: number }[];

  /**
   * Gets the 0-based buffer index of the line's first row.
   */
  readonly firstRow: number;

  /**
   * Gets the 0-based buffer index of the line's last row.
   */
  readonly lastRow: number;
}

/**
 * Finds the addresses and file paths in a terminal's output and hands xterm the links for them.
 *
 * Addresses are linked as found. A path is linked only once {@link TerminalLinkHandlers.resolvePath}
 * has found the file it names, so a word that merely looks like a path does not light up.
 */
export class TerminalLinkProvider implements ILinkProvider {
  /**
   * Holds the reader of the buffer the terminal is showing.
   */
  private readonly buffer: () => IBuffer;

  /**
   * Holds what the terminal does with its links.
   */
  private readonly handlers: TerminalLinkHandlers;

  /**
   * Initializes a new instance of the {@link TerminalLinkProvider} class.
   * @param buffer Reads the buffer the terminal is showing.
   * @param handlers What the terminal does with its links.
   */
  public constructor(buffer: () => IBuffer, handlers: TerminalLinkHandlers) {
    this.buffer = buffer;
    this.handlers = handlers;
  }

  /**
   * Provides the links on the line under the pointer.
   * @param bufferLineNumber The 1-based buffer row the pointer is on.
   * @param callback Receives the links, or undefined when there are none.
   */
  public provideLinks(
    bufferLineNumber: number,
    callback: (links: ILink[] | undefined) => void,
  ): void {
    const line: TerminalLogicalLine = readLogicalLine(this.buffer(), bufferLineNumber);
    void findTerminalLinks(line, this.handlers.resolvePath).then(
      (found: readonly TerminalFoundLink[]): void =>
        callback(
          found.length > 0
            ? found.map((link: TerminalFoundLink): ILink => this.link(link))
            : undefined,
        ),
    );
  }

  /**
   * Builds xterm's link for a link found in the output.
   * @param found The link found.
   * @returns Returns the link.
   */
  private link(found: TerminalFoundLink): ILink {
    return {
      range: found.range,
      text: found.text,
      activate: (event: MouseEvent): void => this.handlers.activate(event, found.target),
      hover: (event: MouseEvent): void => this.handlers.hover(event, found.target),
      leave: (): void => this.handlers.leave(),
    };
  }
}

/**
 * Represents a link found in a line of terminal output: where it is drawn, its text, and what it
 * points at.
 */
export interface TerminalFoundLink {
  /**
   * Gets the cells the link covers.
   */
  readonly range: IBufferRange;

  /**
   * Gets the link's text as drawn.
   */
  readonly text: string;

  /**
   * Gets what the link points at.
   */
  readonly target: TerminalLinkTarget;
}

/**
 * Finds the links in a line of terminal output: every web address, and every path that names a file
 * the resolver finds. A path the resolver cannot settle — it fails, or there is none — is not a link.
 * @param line The line.
 * @param resolvePath Resolves a printed path to the file it names, or null to link addresses only.
 * @returns Returns the links, addresses first, then paths, each in the order they appear.
 */
export async function findTerminalLinks(
  line: TerminalLogicalLine,
  resolvePath: ((path: string) => Promise<string | null>) | null,
): Promise<readonly TerminalFoundLink[]> {
  const found: (match: TerminalTextMatch, target: TerminalLinkTarget) => TerminalFoundLink = (
    match: TerminalTextMatch,
    target: TerminalLinkTarget,
  ): TerminalFoundLink => ({
    range: rangeOf(line, match),
    text: line.text.slice(match.start, match.end),
    target,
  });
  const urls: readonly TerminalUrlMatch[] = findTerminalUrls(line.text);
  const links: TerminalFoundLink[] = urls.map((match: TerminalUrlMatch): TerminalFoundLink =>
    found(match, { kind: 'url', url: match.url }),
  );
  if (resolvePath === null) {
    return links;
  }
  const paths: readonly TerminalPathMatch[] = findTerminalPaths(line.text, urls);
  const resolved: (string | null)[] = await Promise.all(
    paths.map((match: TerminalPathMatch): Promise<string | null> =>
      resolvePath(match.path).catch((): null => null),
    ),
  );
  paths.forEach((match: TerminalPathMatch, index: number): void => {
    const path: string | null = resolved[index];
    if (path !== null) {
      links.push(found(match, { kind: 'path', path, line: match.line, column: match.column }));
    }
  });
  return links;
}

/**
 * Reads the logical line a buffer row belongs to: the rows before it that it continues, and the rows
 * after it that continue it, as one string.
 *
 * Read cell by cell rather than with `translateToString`, so the position of every character is
 * known: a wide character (CJK, most emoji) takes two cells but is one character of the string.
 * @param buffer The buffer.
 * @param bufferLineNumber The 1-based row.
 * @returns Returns the line.
 */
export function readLogicalLine(buffer: IBuffer, bufferLineNumber: number): TerminalLogicalLine {
  let first: number = bufferLineNumber - 1;
  while (first > 0 && buffer.getLine(first)?.isWrapped === true) {
    first--;
  }
  let text: string = '';
  const cells: { x: number; y: number; width: number }[] = [];
  let scratch: IBufferCell | undefined;
  let last: number = first;
  for (let row: number = first; ; row++) {
    const line: IBufferLine | undefined = buffer.getLine(row);
    if (line === undefined || (row !== first && !line.isWrapped)) {
      break;
    }
    last = row;
    if (text.length >= MAX_LINK_LINE_LENGTH) {
      // Past the searched stretch, but still this line's row: the caller moves on from its end.
      continue;
    }
    for (let x: number = 0; x < line.length; x++) {
      scratch = line.getCell(x, scratch);
      if (scratch === undefined) {
        break;
      }
      const width: number = scratch.getWidth();
      if (width === 0) {
        // The second half of a wide character, already read with its first.
        continue;
      }
      const chars: string = scratch.getChars() || ' ';
      // One position per UTF-16 unit, as the string is indexed: an emoji is two units in one cell.
      const position: { x: number; y: number; width: number } = { x: x + 1, y: row + 1, width };
      cells.push(...Array.from({ length: chars.length }, (): typeof position => position));
      text += chars;
    }
  }
  return { text, cells, firstRow: first, lastRow: last };
}

/**
 * Gets the cells a match covers, from its first character's cell to the last cell of its last.
 * @param line The line the match was found in.
 * @param match The match.
 * @returns Returns the range.
 */
function rangeOf(line: TerminalLogicalLine, match: TerminalTextMatch): IBufferRange {
  const first: TerminalLogicalLine['cells'][number] = line.cells[match.start];
  const last: TerminalLogicalLine['cells'][number] = line.cells[match.end - 1];
  const start: IBufferCellPosition = { x: first.x, y: first.y };
  const end: IBufferCellPosition = { x: last.x + last.width - 1, y: last.y };
  return { start, end };
}
