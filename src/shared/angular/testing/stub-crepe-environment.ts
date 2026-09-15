/**
 * Gives jsdom the browser surface a Crepe editor reaches for at boot, so a spec that mounts one fails
 * on its own bugs rather than on a missing API. Call from `beforeAll`; pair it with
 * {@link drainMilkdownTimers} in `afterAll`.
 *
 * Crepe's features observe layout through `ResizeObserver` and `IntersectionObserver`, neither of
 * which jsdom has, and its virtual-cursor plugin asks a `Range` for client rects whenever the selection
 * moves with focus. The observers become inert stubs and the rects come back empty; nothing here
 * performs layout, so nothing here can be asserted on.
 */
export function stubCrepeEnvironment(): void {
  class StubObserver {
    public observe(): void {
      /* jsdom has no layout to observe */
    }

    public unobserve(): void {
      /* jsdom has no layout to observe */
    }

    public disconnect(): void {
      /* jsdom has no layout to observe */
    }
  }
  const globalRef: { ResizeObserver?: unknown; IntersectionObserver?: unknown } = globalThis;
  globalRef.ResizeObserver ??= StubObserver;
  globalRef.IntersectionObserver ??= StubObserver;

  Object.assign(Range.prototype, {
    getClientRects: (): DOMRectList => [] as unknown as DOMRectList,
    getBoundingClientRect: (): DOMRect => new DOMRect(0, 0, 0, 0),
  });
}
