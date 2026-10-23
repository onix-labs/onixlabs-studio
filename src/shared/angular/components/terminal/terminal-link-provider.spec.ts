import { IBuffer, IBufferCell, IBufferLine, ILink } from '@xterm/xterm';
import {
  readLogicalLine,
  TerminalLogicalLine,
  TerminalLinkHandlers,
  TerminalLinkProvider,
  TerminalLinkTarget,
} from './terminal-link-provider';

/**
 * Represents one cell of a fake buffer row: its characters and how many columns it is drawn across.
 */
interface FakeCell {
  readonly chars: string;
  readonly width: number;
}

/**
 * Builds a fake buffer row from its text, one cell per character, with any character listed in
 * `wide` drawn two columns wide (followed by the empty cell xterm leaves after a wide character).
 * @param text The row's text.
 * @param isWrapped Whether the row continues the one before it.
 * @param wide The characters drawn two columns wide.
 * @returns Returns the row.
 */
function row(text: string, isWrapped: boolean = false, wide: string = ''): IBufferLine {
  const cells: FakeCell[] = [];
  for (const chars of text) {
    if (wide.includes(chars)) {
      cells.push({ chars, width: 2 }, { chars: '', width: 0 });
    } else {
      cells.push({ chars, width: 1 });
    }
  }
  return {
    isWrapped,
    length: cells.length,
    getCell: (x: number): IBufferCell | undefined => {
      const cell: FakeCell | undefined = cells[x];
      return cell === undefined
        ? undefined
        : ({ getChars: () => cell.chars, getWidth: () => cell.width } as unknown as IBufferCell);
    },
    translateToString: (): string => text,
  };
}

/**
 * Builds a fake buffer from its rows.
 * @param rows The rows.
 * @returns Returns the buffer.
 */
function buffer(rows: readonly IBufferLine[]): IBuffer {
  return {
    getLine: (index: number): IBufferLine | undefined => rows[index],
  } as unknown as IBuffer;
}

/**
 * Asks a provider for the links on a row.
 * @param provider The provider.
 * @param bufferLineNumber The 1-based row.
 * @returns Returns the links, or undefined when there are none.
 */
function linksOn(
  provider: TerminalLinkProvider,
  bufferLineNumber: number,
): Promise<ILink[] | undefined> {
  return new Promise((resolve: (links: ILink[] | undefined) => void): void =>
    provider.provideLinks(bufferLineNumber, resolve),
  );
}

/**
 * Builds handlers that record what they were called with.
 * @param resolvePath The path resolver, or null for a terminal that links addresses only.
 * @returns Returns the handlers.
 */
function handlers(
  resolvePath: TerminalLinkHandlers['resolvePath'],
): TerminalLinkHandlers & { readonly activated: TerminalLinkTarget[] } {
  const activated: TerminalLinkTarget[] = [];
  return {
    resolvePath,
    activated,
    activate: (_event: MouseEvent, target: TerminalLinkTarget): void => {
      activated.push(target);
    },
    hover: (): void => undefined,
    leave: (): void => undefined,
  };
}

describe('TerminalLinkProvider', () => {
  it('readLogicalLine_onAWrappedRow_joinsTheRowsOfItsLine', () => {
    const lines: IBuffer = buffer([row('first'), row('abc'), row('def', true), row('ghi', true)]);
    const line: TerminalLogicalLine = readLogicalLine(lines, 3);
    expect(line.text).toBe('abcdefghi');
    expect(line.cells[3]).toEqual({ x: 1, y: 3, width: 1 });
  });

  it('readLogicalLine_withWideCharacters_mapsEachToItsFirstCell', () => {
    const line: TerminalLogicalLine = readLogicalLine(buffer([row('日本x', false, '日本')]), 1);
    expect(line.text).toBe('日本x');
    expect(line.cells.map((cell) => cell.x)).toEqual([1, 3, 5]);
  });

  it('provideLinks_withAnAddressWrappedAcrossRows_linksItAsOneRange', async () => {
    const provider: TerminalLinkProvider = new TerminalLinkProvider(
      () => buffer([row('see http://loc'), row('alhost:5173/ ok', true)]),
      handlers(null),
    );
    const links: ILink[] | undefined = await linksOn(provider, 2);
    expect(links).toHaveLength(1);
    expect(links?.[0].text).toBe('http://localhost:5173/');
    expect(links?.[0].range).toEqual({ start: { x: 5, y: 1 }, end: { x: 12, y: 2 } });
  });

  it('provideLinks_afterAWideCharacter_endsOnTheRightCell', async () => {
    const provider: TerminalLinkProvider = new TerminalLinkProvider(
      () => buffer([row('日 http://a.io', false, '日')]),
      handlers(null),
    );
    const links: ILink[] | undefined = await linksOn(provider, 1);
    expect(links?.[0].range).toEqual({ start: { x: 4, y: 1 }, end: { x: 14, y: 1 } });
  });

  it('provideLinks_withoutAPathResolver_linksNoPaths', async () => {
    const provider: TerminalLinkProvider = new TerminalLinkProvider(
      () => buffer([row('error at src/main.ts:4:2')]),
      handlers(null),
    );
    expect(await linksOn(provider, 1)).toBeUndefined();
  });

  it('provideLinks_withPaths_linksOnlyThoseThatResolve', async () => {
    const resolvePath: (path: string) => Promise<string | null> = vi.fn(
      (path: string): Promise<string | null> =>
        Promise.resolve(path === 'src/main.ts' ? '/ws/src/main.ts' : null),
    );
    const recorded: ReturnType<typeof handlers> = handlers(resolvePath);
    const provider: TerminalLinkProvider = new TerminalLinkProvider(
      () => buffer([row('src/main.ts:4:2 and src/gone.ts:1')]),
      recorded,
    );
    const links: ILink[] | undefined = await linksOn(provider, 1);
    expect(resolvePath).toHaveBeenCalledTimes(2);
    expect(links).toHaveLength(1);
    expect(links?.[0].text).toBe('src/main.ts:4:2');

    links?.[0].activate(new MouseEvent('click'), links[0].text);
    expect(recorded.activated).toEqual([
      { kind: 'path', path: '/ws/src/main.ts', line: 4, column: 2 },
    ]);
  });

  it('provideLinks_whenResolvingFails_linksTheRestAnyway', async () => {
    const provider: TerminalLinkProvider = new TerminalLinkProvider(
      () => buffer([row('src/main.ts http://a.io')]),
      handlers(async (): Promise<string | null> => Promise.reject(new Error('gone'))),
    );
    const links: ILink[] | undefined = await linksOn(provider, 1);
    expect(links?.map((link: ILink) => link.text)).toEqual(['http://a.io']);
  });
});
