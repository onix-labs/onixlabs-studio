import {
  IBuffer,
  IBufferCell,
  IBufferLine,
  IDecoration,
  IDecorationOptions,
  IDisposable,
  IMarker,
  Terminal as Xterm,
} from '@xterm/xterm';
import { TerminalLinkDecorator } from './terminal-link-decorator';

/**
 * Represents a colour the fake terminal was asked to draw.
 */
interface DrawnColour {
  readonly line: number;
  readonly x: number;
  readonly width: number;
  readonly colour: string | undefined;
  disposed: boolean;
}

/**
 * Represents a fake terminal: rows of text, a cursor on the last one, and a record of what was drawn.
 */
interface FakeTerminal {
  readonly xterm: Xterm;
  readonly drawn: DrawnColour[];
  /**
   * Replaces the rows (each `[text, isWrapped]`) and reports the write as parsed.
   */
  write(rows: readonly (readonly [string, boolean])[]): void;
  /**
   * Switches between the normal and the alternate screen.
   */
  setType(type: 'normal' | 'alternate'): void;
}

/**
 * Builds a fake buffer row, one cell per character.
 * @param text The row's text.
 * @param isWrapped Whether the row continues the one before it.
 * @returns Returns the row.
 */
function row(text: string, isWrapped: boolean): IBufferLine {
  const chars: string[] = [...text];
  return {
    isWrapped,
    length: chars.length,
    getCell: (x: number): IBufferCell | undefined =>
      x < chars.length
        ? ({ getChars: () => chars[x], getWidth: () => 1 } as unknown as IBufferCell)
        : undefined,
  } as unknown as IBufferLine;
}

/**
 * Builds the fake terminal.
 * @returns Returns it.
 */
function fakeTerminal(): FakeTerminal {
  let rows: IBufferLine[] = [];
  let type: 'normal' | 'alternate' = 'normal';
  const drawn: DrawnColour[] = [];
  const onWrite: (() => void)[] = [];
  const buffer: IBuffer = {
    get type(): 'normal' | 'alternate' {
      return type;
    },
    get length(): number {
      return rows.length;
    },
    baseY: 0,
    get cursorY(): number {
      return rows.length - 1;
    },
    getLine: (index: number): IBufferLine | undefined => rows[index],
  } as unknown as IBuffer;
  const none: IDisposable = { dispose: (): void => undefined };
  const xterm: Xterm = {
    cols: 20,
    buffer: { active: buffer, onBufferChange: () => none },
    onWriteParsed: (listener: () => void): IDisposable => {
      onWrite.push(listener);
      return none;
    },
    onResize: () => none,
    registerMarker: (offset: number): IMarker => {
      const marker: { line: number; isDisposed: boolean } = {
        line: rows.length - 1 + offset,
        isDisposed: false,
      };
      return {
        get line(): number {
          return marker.line;
        },
        get isDisposed(): boolean {
          return marker.isDisposed;
        },
        dispose: (): void => {
          marker.isDisposed = true;
        },
        onDispose: () => none,
      } as unknown as IMarker;
    },
    registerDecoration: (options: IDecorationOptions): IDecoration => {
      const colour: DrawnColour = {
        line: options.marker.line,
        x: options.x ?? 0,
        width: options.width ?? 1,
        colour: options.foregroundColor,
        disposed: false,
      };
      drawn.push(colour);
      return {
        dispose: (): void => {
          colour.disposed = true;
        },
        onDispose: () => none,
      } as unknown as IDecoration;
    },
  } as unknown as Xterm;
  return {
    xterm,
    drawn,
    write: (next: readonly (readonly [string, boolean])[]): void => {
      rows = next.map(([text, wrapped]: readonly [string, boolean]) => row(text, wrapped));
      onWrite.forEach((listener: () => void): void => listener());
    },
    setType: (next: 'normal' | 'alternate'): void => {
      type = next;
    },
  };
}

/**
 * Lets the decorator's pass run: its settle delay, then its awaits.
 */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(100);
}

/**
 * Gets the colours still drawn.
 * @param terminal The fake terminal.
 * @returns Returns them, without the colour.
 */
function live(terminal: FakeTerminal): { line: number; x: number; width: number }[] {
  return terminal.drawn
    .filter((colour: DrawnColour): boolean => !colour.disposed)
    .map(({ line, x, width }: DrawnColour) => ({ line, x, width }));
}

describe('TerminalLinkDecorator', () => {
  let terminal: FakeTerminal;
  let decorator: TerminalLinkDecorator | null;

  beforeEach(() => {
    vi.useFakeTimers();
    terminal = fakeTerminal();
    decorator = null;
  });

  afterEach(() => {
    decorator?.dispose();
    vi.useRealTimers();
  });

  it('write_withAnAddress_drawsItInTheLinkColour', async () => {
    decorator = new TerminalLinkDecorator(terminal.xterm, null, () => '#0dcaec');
    terminal.write([
      ['at http://a.io/x', false],
      ['$ ', false],
    ]);
    await settle();
    expect(terminal.drawn).toEqual([
      { line: 0, x: 3, width: 13, colour: '#0dcaec', disposed: false },
    ]);
  });

  it('write_withAWrappedAddress_drawsEachRowOfIt', async () => {
    decorator = new TerminalLinkDecorator(terminal.xterm, null, () => '#0dcaec');
    terminal.write([
      ['see http://example.c', false],
      ['om/page done', true],
      ['$ ', false],
    ]);
    await settle();
    expect(live(terminal)).toEqual([
      { line: 0, x: 4, width: 16 },
      { line: 1, x: 0, width: 7 },
    ]);
  });

  it('write_withPaths_drawsOnlyThoseThatResolve', async () => {
    decorator = new TerminalLinkDecorator(
      terminal.xterm,
      (path: string): Promise<string | null> =>
        Promise.resolve(path === 'src/a.ts' ? '/ws/src/a.ts' : null),
      () => '#0dcaec',
    );
    terminal.write([
      ['src/a.ts:1 src/b.ts', false],
      ['$ ', false],
    ]);
    await settle();
    expect(live(terminal)).toEqual([{ line: 0, x: 0, width: 10 }]);
  });

  it('write_again_doesNotRedrawFinishedLines', async () => {
    decorator = new TerminalLinkDecorator(terminal.xterm, null, () => '#0dcaec');
    terminal.write([
      ['http://a.io', false],
      ['$ ', false],
    ]);
    await settle();
    terminal.write([
      ['http://a.io', false],
      ['next http://b.io', false],
      ['$ ', false],
    ]);
    await settle();
    expect(live(terminal)).toEqual([
      { line: 0, x: 0, width: 11 },
      { line: 1, x: 5, width: 11 },
    ]);
    expect(terminal.drawn).toHaveLength(2);
  });

  it('write_onTheCursorsLine_redrawsItAsItGrows', async () => {
    decorator = new TerminalLinkDecorator(terminal.xterm, null, () => '#0dcaec');
    terminal.write([['$ open http://a.io', false]]);
    await settle();
    terminal.write([['$ open http://a.io/more', false]]);
    await settle();
    expect(live(terminal)).toEqual([{ line: 0, x: 7, width: 16 }]);
  });

  it('write_onTheAlternateScreen_drawsNothing', async () => {
    decorator = new TerminalLinkDecorator(terminal.xterm, null, () => '#0dcaec');
    terminal.setType('alternate');
    terminal.write([
      ['http://a.io', false],
      ['$ ', false],
    ]);
    await settle();
    expect(terminal.drawn).toEqual([]);
  });

  it('recolour_drawsEverythingAgain', async () => {
    let colour: string = '#0dcaec';
    decorator = new TerminalLinkDecorator(terminal.xterm, null, () => colour);
    terminal.write([
      ['http://a.io', false],
      ['$ ', false],
    ]);
    await settle();
    colour = '#112233';
    decorator.recolour();
    await settle();
    expect(terminal.drawn.map((drawn: DrawnColour) => [drawn.colour, drawn.disposed])).toEqual([
      ['#0dcaec', true],
      ['#112233', false],
    ]);
  });
});
