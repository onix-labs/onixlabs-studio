import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouteMap } from './route-map';
import { RouteStop } from './route-stop';
import { loadWorldCountries } from './world-countries';

describe('RouteMap', () => {
  let fixture: ComponentFixture<RouteMap>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RouteMap] }).compileComponents();
    fixture = TestBed.createComponent(RouteMap);
    host = fixture.nativeElement as HTMLElement;
  });

  /**
   * Draws a route.
   * @param stops The route's stops.
   */
  async function draw(stops: readonly RouteStop[]): Promise<void> {
    fixture.componentRef.setInput('stops', stops);
    await loadWorldCountries();
    await fixture.whenStable();
  }

  /**
   * Gets the markers' labels, in order.
   * @returns Returns the labels.
   */
  function labels(): readonly string[] {
    return Array.from(host.querySelectorAll('[data-testid="route-map-marker"] text')).map(
      (text: Element): string => text.textContent.trim(),
    );
  }

  it('drawsTheWorld_withNoRoute', async () => {
    await draw([]);

    expect(host.querySelector('.route-map__land')?.getAttribute('d')?.length).toBeGreaterThan(1000);
    expect(host.querySelector('[data-testid="route-map-line"]')?.getAttribute('d')).toBe('');
    expect(labels()).toEqual([]);
  });

  it('joinsTheStops_andMarksEachPlaceOnce', async () => {
    await draw([
      { hop: 2, latitude: 51.5, longitude: -0.12, place: 'London, United Kingdom' },
      { hop: 3, latitude: 51.5, longitude: -0.12, place: 'London, United Kingdom' },
      { hop: 6, latitude: 37.4, longitude: -122.08, place: 'Mountain View, United States' },
    ]);

    expect(labels()).toEqual(['2, 3', '6']);
    expect(host.querySelector('[data-testid="route-map-line"]')?.getAttribute('d')).toMatch(/^M/);
    const markers: readonly Element[] = Array.from(
      host.querySelectorAll('[data-testid="route-map-marker"]'),
    );
    expect(markers[1].classList.contains('route-map__marker--last')).toBe(true);
    expect(markers[0].querySelector('title')?.textContent).toBe(
      'Hops 2, 3: London, United Kingdom',
    );
  });

  it('keepsEveryMarkerInsideTheDrawing', async () => {
    await draw([
      { hop: 1, latitude: 51.5, longitude: -0.12, place: 'London' },
      { hop: 2, latitude: -33.86, longitude: 151.2, place: 'Sydney' },
    ]);

    const positions: readonly (readonly number[])[] = Array.from(
      host.querySelectorAll('[data-testid="route-map-marker"]'),
    ).map((marker: Element): readonly number[] =>
      (/translate\(([-\d.]+),([-\d.]+)\)/.exec(marker.getAttribute('transform') ?? '') ?? [])
        .slice(1)
        .map(Number),
    );
    for (const [x, y] of positions) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(960);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(480);
    }
  });

  it('givesEachMapItsOwnClipPath', async () => {
    const other: ComponentFixture<RouteMap> = TestBed.createComponent(RouteMap);
    await draw([]);
    await other.whenStable();

    const ids: readonly (string | null | undefined)[] = [
      host,
      other.nativeElement as HTMLElement,
    ].map((element: HTMLElement): string | null | undefined =>
      element.querySelector('clipPath')?.getAttribute('id'),
    );
    expect(new Set(ids).size).toBe(2);
  });
});
