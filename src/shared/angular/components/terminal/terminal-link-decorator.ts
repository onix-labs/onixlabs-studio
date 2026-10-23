import { IBuffer, IDecoration, IDisposable, IMarker, Terminal as Xterm } from '@xterm/xterm';
import {
  findTerminalLinks,
  readLogicalLine,
  TerminalFoundLink,
  TerminalLogicalLine,
} from './terminal-link-provider';

/**
 * Holds how long output is left to settle before it is searched for links, in milliseconds. A build
 * prints in bursts; searching once per burst rather than once per chunk keeps the cost to one pass.
 */
const SCAN_DELAY_MS: number = 50;

/**
 * Holds the most rows searched in one pass. A burst bigger than this — a replayed scrollback, a log
 * dumped all at once — has only its newest rows coloured; the older ones still link on hover.
 */
const MAX_ROWS_PER_SCAN: number = 1000;

/**
 * Colours the links in a terminal's output as it is printed (#1061), so an address or a file path
 * reads as a link before the pointer finds it.
 *
 * Output is searched line by line as it arrives. A finished line is coloured once and its colour
 * travels with it: it is pinned to the line by a marker, and goes when the line leaves the
 * scrollback. The line the cursor is on may still grow, so it is searched again with each burst.
 * Only the normal screen is coloured — a full-screen program (an editor, a pager) draws its own.
 */
export class TerminalLinkDecorator implements IDisposable {
  /**
   * Holds the terminal whose output is coloured.
   */
  private readonly xterm: Xterm;

  /**
   * Holds the resolver for printed paths, or null to colour addresses only.
   */
  private readonly resolvePath: ((path: string) => Promise<string | null>) | null;

  /**
   * Reads the colour links are drawn in, as `#RRGGBB`.
   */
  private readonly colour: () => string;

  /**
   * Holds the subscriptions to the terminal's events.
   */
  private readonly subscriptions: IDisposable[] = [];

  /**
   * Holds every colour drawn, so a reflow can take them all down.
   */
  private readonly decorations: Set<IDecoration> = new Set<IDecoration>();

  /**
   * Holds the colours drawn on the line the cursor is on, which are redrawn as the line grows.
   */
  private tail: IDisposable[] = [];

  /**
   * Holds a marker on the first line not yet coloured, or null to start from the top of the buffer.
   */
  private scanFrom: IMarker | null = null;

  /**
   * Holds the timer for the next pass, or null when none is due.
   */
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds whether a pass is running.
   */
  private scanning: boolean = false;

  /**
   * Holds which colouring the passes belong to. A recolour starts a new one, and a pass that began
   * under the old one stops rather than carrying on from where the old colours were.
   */
  private generation: number = 0;

  /**
   * Holds whether a pass is wanted once the running one finishes.
   */
  private rescan: boolean = false;

  /**
   * Holds whether the decorator has been disposed.
   */
  private disposed: boolean = false;

  /**
   * Initializes a new instance of the {@link TerminalLinkDecorator} class, and colours what is
   * already in the buffer.
   * @param xterm The terminal whose output is coloured.
   * @param resolvePath Resolves a printed path to the file it names, or null to colour addresses only.
   * @param colour Reads the colour links are drawn in, as `#RRGGBB`.
   */
  public constructor(
    xterm: Xterm,
    resolvePath: ((path: string) => Promise<string | null>) | null,
    colour: () => string,
  ) {
    this.xterm = xterm;
    this.resolvePath = resolvePath;
    this.colour = colour;
    this.subscriptions.push(
      xterm.onWriteParsed((): void => this.schedule()),
      // A change of width reflows wrapped lines, and every colour is pinned to a column.
      xterm.onResize((): void => this.recolour()),
      // Back from a full-screen program: carry on with the normal screen's output.
      xterm.buffer.onBufferChange((): void => this.schedule()),
    );
    this.schedule();
  }

  /**
   * Takes every colour down and colours the whole buffer again — for a reflow, or a new colour.
   */
  public recolour(): void {
    this.generation++;
    if (this.scanning) {
      this.rescan = true;
    }
    for (const decoration of [...this.decorations]) {
      decoration.dispose();
    }
    this.decorations.clear();
    this.tail = [];
    this.scanFrom?.dispose();
    this.scanFrom = null;
    this.schedule();
  }

  /**
   * Stops colouring and takes every colour down.
   */
  public dispose(): void {
    this.disposed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    for (const decoration of [...this.decorations]) {
      decoration.dispose();
    }
    this.decorations.clear();
    this.scanFrom?.dispose();
  }

  /**
   * Schedules a pass once the output has settled.
   */
  private schedule(): void {
    if (this.disposed || this.timer !== null) {
      return;
    }
    this.timer = setTimeout((): void => {
      this.timer = null;
      void this.scan();
    }, SCAN_DELAY_MS);
  }

  /**
   * Colours the lines printed since the last pass, and the line the cursor is on.
   */
  private async scan(): Promise<void> {
    if (this.scanning) {
      this.rescan = true;
      return;
    }
    const buffer: IBuffer = this.xterm.buffer.active;
    if (this.disposed || buffer.type !== 'normal') {
      return;
    }
    this.scanning = true;
    const generation: number = this.generation;
    try {
      for (const disposable of this.tail) {
        disposable.dispose();
      }
      this.tail = [];
      const marked: number =
        this.scanFrom === null || this.scanFrom.isDisposed ? 0 : this.scanFrom.line;
      let row: number = Math.max(marked, buffer.length - MAX_ROWS_PER_SCAN, 0);
      // Down to the cursor's line: below it is screen not yet written to.
      while (row < buffer.length && row <= buffer.baseY + buffer.cursorY && !this.disposed) {
        const line: TerminalLogicalLine = readLogicalLine(buffer, row + 1);
        // Pin the line before the search can wait: output that arrives meanwhile, and scrollback
        // trimmed to make room for it, moves the line, and a marker moves with it.
        const markers: IMarker[] = this.markRows(buffer, line);
        const isTail: boolean = line.lastRow >= buffer.baseY + buffer.cursorY;
        const links: readonly TerminalFoundLink[] = await findTerminalLinks(line, this.resolvePath);
        if (
          this.disposed ||
          this.generation !== generation ||
          this.xterm.buffer.active !== buffer
        ) {
          markers.forEach((marker: IMarker): void => marker.dispose());
          return;
        }
        const drawn: IDecoration[] = this.draw(line, links, markers);
        if (isTail) {
          this.tail.push(...drawn, ...markers);
        } else if (drawn.length === 0) {
          markers.forEach((marker: IMarker): void => marker.dispose());
        }
        // Where the line is now, which output during the search may have moved.
        const first: IMarker | undefined = markers[0];
        const now: number = first === undefined || first.isDisposed ? row : first.line;
        row = now + (line.lastRow - line.firstRow) + 1;
        if (!isTail) {
          this.advanceTo(buffer, row);
        }
      }
    } finally {
      this.scanning = false;
      if (this.rescan) {
        this.rescan = false;
        this.schedule();
      }
    }
  }

  /**
   * Pins a marker to each row of a line.
   * @param buffer The buffer the line is in.
   * @param line The line.
   * @returns Returns the markers, one per row from the first.
   */
  private markRows(buffer: IBuffer, line: TerminalLogicalLine): IMarker[] {
    const cursor: number = buffer.baseY + buffer.cursorY;
    const markers: IMarker[] = [];
    for (let row: number = line.firstRow; row <= line.lastRow; row++) {
      const marker: IMarker | undefined = this.xterm.registerMarker(row - cursor);
      if (marker !== undefined) {
        markers.push(marker);
      }
    }
    return markers;
  }

  /**
   * Draws a line's links in the link colour, one stretch per row a link covers.
   * @param line The line.
   * @param links The links found in it.
   * @param markers The markers pinned to its rows.
   * @returns Returns the colours drawn.
   */
  private draw(
    line: TerminalLogicalLine,
    links: readonly TerminalFoundLink[],
    markers: readonly IMarker[],
  ): IDecoration[] {
    const colour: string = this.colour();
    const cols: number = this.xterm.cols;
    const drawn: IDecoration[] = [];
    for (const link of links) {
      const { start, end } = link.range;
      for (let y: number = start.y; y <= end.y; y++) {
        const marker: IMarker | undefined = markers[y - 1 - line.firstRow];
        if (marker === undefined || marker.isDisposed) {
          continue;
        }
        const from: number = y === start.y ? start.x : 1;
        const to: number = y === end.y ? end.x : cols;
        const decoration: IDecoration | undefined = this.xterm.registerDecoration({
          marker,
          x: from - 1,
          width: to - from + 1,
          foregroundColor: colour,
        });
        if (decoration !== undefined) {
          this.decorations.add(decoration);
          decoration.onDispose((): boolean => this.decorations.delete(decoration));
          drawn.push(decoration);
        }
      }
    }
    return drawn;
  }

  /**
   * Moves the start of the next pass to a row: everything above it is coloured.
   * @param buffer The buffer.
   * @param row The 0-based row.
   */
  private advanceTo(buffer: IBuffer, row: number): void {
    this.scanFrom?.dispose();
    this.scanFrom = this.xterm.registerMarker(row - (buffer.baseY + buffer.cursorY)) ?? null;
  }
}
