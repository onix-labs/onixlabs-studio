import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Settings } from '@shared/angular/services/settings/settings';
import { TileScrollMode } from '@shared/angular/services/settings/settings-registry';
import { MissionControlTiles } from './mission-control-tiles';

/**
 * A fake tile element that records the scroll calls made against it and reports a fixed geometry, so
 * the registry's scroll and measurement logic can be exercised without a real layout engine.
 */
interface FakeTile {
  /**
   * Gets the element handed to the registry (a stand-in for the tile's root element).
   */
  readonly element: HTMLElement;

  /**
   * Gets the arguments of each {@link HTMLElement.scrollIntoView} call, in order.
   */
  readonly scrollIntoViewCalls: unknown[];
}

/**
 * A fake scrolling row that records its {@link HTMLElement.scrollBy} calls and reports a fixed width
 * and viewport rect, standing in for the horizontally-scrolling column row.
 */
interface FakeRow {
  /**
   * Gets the row element handed to the registry.
   */
  readonly element: HTMLElement;

  /**
   * Gets the arguments of each {@link Element.scrollBy} call, in order.
   */
  readonly scrollByCalls: unknown[];
}

/**
 * Creates a fake tile with the given laid-out width and left offset. It is reported as visible
 * (a non-null `offsetParent`) unless stated otherwise, so it counts toward the column measurements.
 * @param offsetWidth The tile's laid-out width in pixels.
 * @param left The tile's left viewport offset in pixels.
 * @param visible Whether the tile is on screen (a non-null `offsetParent`).
 * @returns Returns the fake tile.
 */
function makeTile(offsetWidth: number, left: number = 0, visible: boolean = true): FakeTile {
  const scrollIntoViewCalls: unknown[] = [];
  const element: unknown = {
    offsetWidth,
    offsetParent: visible ? ({} as Element) : null,
    getBoundingClientRect: (): DOMRect => ({ left }) as DOMRect,
    scrollIntoView: (arg: unknown): void => {
      scrollIntoViewCalls.push(arg);
    },
  };
  return { element: element as HTMLElement, scrollIntoViewCalls };
}

/**
 * Creates a fake spacer element whose `style.flex` writes can be read back.
 * @returns Returns the fake spacer element.
 */
function makeSpacer(): HTMLElement {
  return { style: { flex: '' } } as unknown as HTMLElement;
}

/**
 * A fake spacer that counts how many times its `style.flex` is assigned, to prove no-op writes are
 * skipped.
 */
interface CountingSpacer {
  readonly element: HTMLElement;
  readonly writes: () => number;
}

/**
 * Creates a spacer whose `style.flex` setter records each assignment.
 * @returns Returns the counting spacer.
 */
function makeCountingSpacer(): CountingSpacer {
  let flex: string = '';
  let writes: number = 0;
  const element: unknown = {
    style: {
      get flex(): string {
        return flex;
      },
      set flex(value: string) {
        flex = value;
        writes += 1;
      },
    },
  };
  return { element: element as HTMLElement, writes: (): number => writes };
}

/**
 * Creates a fake row containing the given children, with the given inner width and left offset.
 * @param children The row's children (columns and, typically, the trailing spacer).
 * @param clientWidth The row's inner width in pixels.
 * @param left The row's left viewport offset in pixels.
 * @returns Returns the fake row.
 */
function makeRow(children: readonly HTMLElement[], clientWidth: number, left: number = 0): FakeRow {
  const scrollByCalls: unknown[] = [];
  const element: unknown = {
    children,
    clientWidth,
    getBoundingClientRect: (): DOMRect => ({ left }) as DOMRect,
    scrollBy: (arg: unknown): void => {
      scrollByCalls.push(arg);
    },
  };
  return { element: element as HTMLElement, scrollByCalls };
}

describe('MissionControlTiles', () => {
  let tiles: MissionControlTiles;
  let scrollMode: WritableSignal<TileScrollMode>;

  beforeEach(() => {
    scrollMode = signal<TileScrollMode>('into-view');
    const settingsStub: Partial<Settings> = { missionControlTileScrollMode: scrollMode };
    TestBed.configureTestingModule({
      providers: [MissionControlTiles, { provide: Settings, useValue: settingsStub }],
    });
    tiles = TestBed.inject(MissionControlTiles);
  });

  it('reveal_whenIdRegistered_scrollsThatTileIntoView', () => {
    const tile: FakeTile = makeTile(200);
    tiles.register('h1', tile.element);

    tiles.reveal('h1');

    expect(tile.scrollIntoViewCalls).toEqual([
      { behavior: 'smooth', block: 'nearest', inline: 'nearest' },
    ]);
  });

  it('reveal_whenIdNotRegistered_isASilentNoOp', () => {
    expect((): void => tiles.reveal('missing')).not.toThrow();
  });

  it('register_laterRegistrationForSameId_wins_andTheStaleUnregisterIsANoOp', () => {
    const first: FakeTile = makeTile(200);
    const second: FakeTile = makeTile(200);
    const unregisterFirst: () => void = tiles.register('h1', first.element);
    tiles.register('h1', second.element);

    // The superseded registration must not evict the winner when its cleanup runs.
    unregisterFirst();
    tiles.reveal('h1');

    expect(first.scrollIntoViewCalls).toEqual([]);
    expect(second.scrollIntoViewCalls.length).toBe(1);
  });

  it('register_unregister_dropsTheTile_soRevealBecomesANoOp', () => {
    const tile: FakeTile = makeTile(200);
    const unregister: () => void = tiles.register('h1', tile.element);

    unregister();
    tiles.reveal('h1');

    expect(tile.scrollIntoViewCalls).toEqual([]);
  });

  it('reveal_inAbsoluteLeftMode_alignsTheColumnLeadingEdgeToTheRow', () => {
    scrollMode.set('absolute-left');
    const target: FakeTile = makeTile(300, 500);
    const other: FakeTile = makeTile(300, 800);
    const spacer: HTMLElement = makeSpacer();
    // Columns (600px) overflow the 400px row, so left-alignment is meaningful.
    const row: FakeRow = makeRow([target.element, other.element, spacer], 400, 100);
    tiles.setRow(row.element, spacer);
    tiles.register('h1', target.element);

    tiles.reveal('h1');

    // Aligns the target's left (500) to the row's left (100): scroll by the 400px difference.
    expect(row.scrollByCalls).toEqual([{ left: 400, behavior: 'smooth' }]);
    // In absolute-left mode the minimal-scroll path is not used.
    expect(target.scrollIntoViewCalls).toEqual([]);
  });

  it('reveal_inAbsoluteLeftMode_whenNoRowRegistered_fallsBackToScrollIntoView', () => {
    scrollMode.set('absolute-left');
    const tile: FakeTile = makeTile(200);
    tiles.register('h1', tile.element);

    tiles.reveal('h1');

    expect(tile.scrollIntoViewCalls.length).toBe(1);
  });

  it('refreshSpacer_inIntoViewMode_collapsesTheSpacerToZero', () => {
    const spacer: HTMLElement = makeSpacer();
    const row: FakeRow = makeRow([makeTile(300).element, spacer], 400);

    // setRow calls refreshSpacer once on registration.
    tiles.setRow(row.element, spacer);

    expect(spacer.style.flex).toBe('0 0 0px');
  });

  it('refreshSpacer_inAbsoluteLeftMode_whenColumnsFit_collapsesToZero', () => {
    scrollMode.set('absolute-left');
    const spacer: HTMLElement = makeSpacer();
    // Two 150px columns (300px) fit inside the 400px row.
    const row: FakeRow = makeRow([makeTile(150).element, makeTile(150).element, spacer], 400);

    tiles.setRow(row.element, spacer);

    expect(spacer.style.flex).toBe('0 0 0px');
  });

  it('refreshSpacer_inAbsoluteLeftMode_whenColumnsOverflow_sizesToRowMinusLastColumn', () => {
    scrollMode.set('absolute-left');
    const spacer: HTMLElement = makeSpacer();
    // Columns (300 + 300 = 600px) overflow the 400px row; the trailing room is row - last = 400 - 300.
    const row: FakeRow = makeRow([makeTile(300).element, makeTile(300).element, spacer], 400);

    tiles.setRow(row.element, spacer);

    expect(spacer.style.flex).toBe('0 0 100px');
  });

  it('refreshSpacer_ignoresOffScreenColumns', () => {
    scrollMode.set('absolute-left');
    const spacer: HTMLElement = makeSpacer();
    // The hidden 300px column does not count, so the two visible 150px columns fit and the spacer stays 0.
    const hidden: HTMLElement = makeTile(300, 0, false).element;
    const row: FakeRow = makeRow(
      [makeTile(150).element, makeTile(150).element, hidden, spacer],
      400,
    );

    tiles.setRow(row.element, spacer);

    expect(spacer.style.flex).toBe('0 0 0px');
  });

  it('setRow_clear_isGuardedByIdentity_soAReplacedRowIsNotTornDown', () => {
    scrollMode.set('absolute-left');
    const spacerA: HTMLElement = makeSpacer();
    // Two 300px columns (600px) overflow the 400px row, so the spacer takes on a non-zero width.
    const rowA: FakeRow = makeRow([makeTile(300).element, makeTile(300).element, spacerA], 400);
    const clearA: () => void = tiles.setRow(rowA.element, spacerA);

    const spacerB: HTMLElement = makeSpacer();
    const rowB: FakeRow = makeRow([makeTile(300).element, makeTile(300).element, spacerB], 400);
    tiles.setRow(rowB.element, spacerB);

    // The superseded row's cleanup must leave the current row wired.
    clearA();
    spacerB.style.flex = '';
    tiles.refreshSpacer();
    expect(spacerB.style.flex).toBe('0 0 100px');
  });

  it('refreshSpacer_writesTheSpacerOnceAndSkipsNoOpUpdates', () => {
    const spacer: CountingSpacer = makeCountingSpacer();
    const row: FakeRow = makeRow([makeTile(300).element, spacer.element], 400);

    // setRow performs the first refresh (into-view mode collapses to `0 0 0px`).
    tiles.setRow(row.element, spacer.element);
    expect(spacer.writes()).toBe(1);

    // Nothing changed, so a repeated refresh must not re-touch the spacer (no layout invalidation).
    tiles.refreshSpacer();
    tiles.refreshSpacer();
    expect(spacer.writes()).toBe(1);
  });

  it('setRow_clear_dropsTheRow_soRefreshSpacerBecomesANoOp', () => {
    const spacer: HTMLElement = makeSpacer();
    const row: FakeRow = makeRow([makeTile(300).element, spacer], 400);
    const clear: () => void = tiles.setRow(row.element, spacer);

    clear();
    spacer.style.flex = 'untouched';
    tiles.refreshSpacer();

    expect(spacer.style.flex).toBe('untouched');
  });
});
