import {
  parseStoredWindowState,
  restoreWindowRect,
  StoredWindowState,
  WindowRect,
} from './window-state';

/**
 * Builds a stored state around the given bounds.
 * @param bounds The stored bounds.
 * @param maximized Whether the window was maximized.
 * @returns Returns the stored state.
 */
function stored(bounds: WindowRect, maximized: boolean = false): StoredWindowState {
  return { bounds, maximized };
}

const PRIMARY: WindowRect = { x: 0, y: 0, width: 1920, height: 1080 };
const SECONDARY_LEFT: WindowRect = { x: -1440, y: 0, width: 1440, height: 900 };

describe('parseStoredWindowState', () => {
  it('withAValidState_roundTrips', () => {
    const state: StoredWindowState = stored({ x: 10, y: 20, width: 1280, height: 800 }, true);
    expect(parseStoredWindowState(state)).toEqual(state);
  });

  it('withoutAMaximizedFlag_defaultsToFalse', () => {
    expect(parseStoredWindowState({ bounds: { x: 0, y: 0, width: 100, height: 100 } })).toEqual(
      stored({ x: 0, y: 0, width: 100, height: 100 }),
    );
  });

  it('withNonObjects_returnsNull', () => {
    expect(parseStoredWindowState(null)).toBeNull();
    expect(parseStoredWindowState(undefined)).toBeNull();
    expect(parseStoredWindowState('state')).toBeNull();
    expect(parseStoredWindowState(42)).toBeNull();
  });

  it('withMissingOrMalformedBounds_returnsNull', () => {
    expect(parseStoredWindowState({ maximized: true })).toBeNull();
    expect(parseStoredWindowState({ bounds: 'wide' })).toBeNull();
    expect(parseStoredWindowState({ bounds: { x: 0, y: 0, width: 100 } })).toBeNull();
    expect(parseStoredWindowState({ bounds: { x: '0', y: 0, width: 100, height: 100 } })).toBeNull();
    expect(parseStoredWindowState({ bounds: { x: 0, y: Infinity, width: 100, height: 100 } })).toBeNull();
  });

  it('withNonPositiveDimensions_returnsNull', () => {
    expect(parseStoredWindowState(stored({ x: 0, y: 0, width: 0, height: 100 }))).toBeNull();
    expect(parseStoredWindowState(stored({ x: 0, y: 0, width: 100, height: -1 }))).toBeNull();
  });
});

describe('restoreWindowRect', () => {
  it('withNoDisplays_returnsNull', () => {
    expect(restoreWindowRect(stored({ x: 0, y: 0, width: 1280, height: 800 }), [], 800, 600)).toBeNull();
  });

  it('withOnScreenBounds_keepsThemInPlace', () => {
    const bounds: WindowRect = { x: 100, y: 50, width: 1280, height: 800 };
    expect(restoreWindowRect(stored(bounds), [PRIMARY], 800, 600)).toEqual(bounds);
  });

  it('withBoundsOnASecondaryDisplayAtNegativeCoordinates_keepsThemInPlace', () => {
    const bounds: WindowRect = { x: -1400, y: 40, width: 1200, height: 700 };
    expect(restoreWindowRect(stored(bounds), [PRIMARY, SECONDARY_LEFT], 800, 600)).toEqual(bounds);
  });

  it('withBoundsLargerThanTheirDisplay_clampsTheSizeToItsWorkArea', () => {
    const bounds: WindowRect = { x: 10, y: 10, width: 4000, height: 3000 };
    expect(restoreWindowRect(stored(bounds), [PRIMARY], 800, 600)).toEqual({
      x: 10,
      y: 10,
      width: 1920,
      height: 1080,
    });
  });

  it('withBoundsBelowTheMinimumSize_raisesThemToTheMinimum', () => {
    const bounds: WindowRect = { x: 10, y: 10, width: 400, height: 300 };
    expect(restoreWindowRect(stored(bounds), [PRIMARY], 800, 600)).toEqual({
      x: 10,
      y: 10,
      width: 800,
      height: 600,
    });
  });

  it('withBoundsStrandedOffScreen_recentresOnThePrimaryDisplay', () => {
    // A window left on a monitor that is no longer connected.
    const bounds: WindowRect = { x: 5000, y: 200, width: 1280, height: 800 };
    expect(restoreWindowRect(stored(bounds), [PRIMARY], 800, 600)).toEqual({
      x: (1920 - 1280) / 2,
      y: (1080 - 800) / 2,
      width: 1280,
      height: 800,
    });
  });

  it('withTheTitleStripAboveEveryDisplay_recentresOnTheOverlappingDisplay', () => {
    // The body overlaps the primary display but the grabbable strip sits above the screen.
    const bounds: WindowRect = { x: 100, y: -500, width: 1280, height: 800 };
    expect(restoreWindowRect(stored(bounds), [PRIMARY], 800, 600)).toEqual({
      x: (1920 - 1280) / 2,
      y: (1080 - 800) / 2,
      width: 1280,
      height: 800,
    });
  });

  it('withABarelyVisibleStrip_stillCountsAsReachable', () => {
    // 100px of width and 16px of the strip remain on-screen: exactly the reachability threshold.
    const bounds: WindowRect = { x: 1920 - 100, y: 1080 - 16, width: 1280, height: 800 };
    const restored: WindowRect | null = restoreWindowRect(stored(bounds), [PRIMARY], 800, 600);
    expect(restored).toEqual({ x: 1820, y: 1064, width: 1280, height: 800 });
  });

  it('withFractionalStoredBounds_roundsToWholePixels', () => {
    const bounds: WindowRect = { x: 100.4, y: 50.6, width: 1280.5, height: 800.2 };
    expect(restoreWindowRect(stored(bounds), [PRIMARY], 800, 600)).toEqual({
      x: 100,
      y: 51,
      width: 1281,
      height: 800,
    });
  });
});
