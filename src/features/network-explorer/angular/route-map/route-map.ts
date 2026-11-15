import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { geoGraticule10, geoNaturalEarth1, GeoPath, geoPath, GeoProjection } from 'd3-geo';
import type { FeatureCollection, LineString, MultiPoint } from 'geojson';
import { RouteStop } from './route-stop';
import { loadWorldCountries } from './world-countries';

/**
 * The map's drawing size, in SVG units; it scales to its box.
 */
const WIDTH: number = 960;

/**
 * See {@link WIDTH}.
 */
const HEIGHT: number = 480;

/**
 * The space kept clear around the route, in SVG units, so markers at its edge are not clipped.
 */
const PADDING: number = 48;

/**
 * The least span of the map, in degrees of longitude and latitude, so a route inside one city is
 * shown in its region rather than zoomed to a street.
 */
const MIN_SPAN: { readonly longitude: number; readonly latitude: number } = {
  longitude: 24,
  latitude: 12,
};

/**
 * Counts the maps made, so each names its clip path uniquely: SVG ids are document-wide, and every
 * open route has a map.
 */
let mapsMade: number = 0;

/**
 * Describes one marker: the hops that share a place, drawn as one point.
 */
interface RouteMarker {
  /**
   * Gets the marker's identity, unique on the map.
   */
  readonly key: string;

  /**
   * Gets the marker's position, in SVG units.
   */
  readonly x: number;

  /**
   * See {@link x}.
   */
  readonly y: number;

  /**
   * Gets the hops' numbers, as the marker is labelled.
   */
  readonly label: string;

  /**
   * Gets the tooltip: the hops and their place.
   */
  readonly title: string;

  /**
   * Gets whether the marker is the route's end.
   */
  readonly last: boolean;
}

/**
 * Fits a projection to a route: around its stops with room to spare, or the whole world when there
 * are none.
 * @param stops The stops.
 * @returns Returns the projection.
 */
function fitProjection(stops: readonly RouteStop[]): GeoProjection {
  const projection: GeoProjection = geoNaturalEarth1();
  const extent: [[number, number], [number, number]] = [
    [PADDING, PADDING],
    [WIDTH - PADDING, HEIGHT - PADDING],
  ];
  if (stops.length === 0) {
    return projection.fitExtent(extent, { type: 'Sphere' });
  }
  const longitudes: readonly number[] = stops.map((stop: RouteStop): number => stop.longitude);
  const latitudes: readonly number[] = stops.map((stop: RouteStop): number => stop.latitude);
  const west: number = Math.min(...longitudes);
  const east: number = Math.max(...longitudes);
  const south: number = Math.min(...latitudes);
  const north: number = Math.max(...latitudes);
  const widen: number = Math.max(0, MIN_SPAN.longitude - (east - west)) / 2;
  const heighten: number = Math.max(0, MIN_SPAN.latitude - (north - south)) / 2;
  const corners: MultiPoint = {
    type: 'MultiPoint',
    coordinates: [
      [Math.max(-180, west - widen), Math.max(-85, south - heighten)],
      [Math.min(180, east + widen), Math.min(85, north + heighten)],
    ],
  };
  return projection.fitExtent(extent, corners);
}

/**
 * Draws a traced route on a world map: each hop that has a place, in order, joined by great-circle
 * arcs, over the countries. Hops that share a place — several routers in one data centre — are one
 * marker, labelled with all their numbers.
 *
 * Drawn offline: the outlines are Natural Earth's, bundled, and the projection is d3's. Nothing is
 * fetched to draw it.
 */
@Component({
  selector: 'app-route-map',
  templateUrl: './route-map.html',
  styleUrl: './route-map.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RouteMap {
  /**
   * Gets the route's stops, in hop order.
   */
  public readonly stops: InputSignal<readonly RouteStop[]> = input<readonly RouteStop[]>([]);

  /**
   * Gets the id of this map's clip path, unique in the document.
   */
  protected readonly clipId: string = `route-map-sphere-${String((mapsMade += 1))}`;

  /**
   * Gets the drawing's view box.
   */
  protected readonly viewBox: string = `0 0 ${String(WIDTH)} ${String(HEIGHT)}`;

  /**
   * Holds the countries once loaded.
   */
  private readonly countries: WritableSignal<FeatureCollection | undefined> = signal<
    FeatureCollection | undefined
  >(undefined);

  /**
   * Gets the path generator for the projection fitted to the route.
   */
  private readonly path: Signal<GeoPath> = computed((): GeoPath =>
    geoPath(fitProjection(this.stops())),
  );

  /**
   * Gets the outline of the globe.
   */
  protected readonly sphere: Signal<string> = computed(
    (): string => this.path()({ type: 'Sphere' }) ?? '',
  );

  /**
   * Gets the lines of latitude and longitude, every ten degrees.
   */
  protected readonly graticule: Signal<string> = computed(
    (): string => this.path()(geoGraticule10()) ?? '',
  );

  /**
   * Gets the countries' outlines, or nothing while they load.
   */
  protected readonly land: Signal<string> = computed((): string => {
    const countries: FeatureCollection | undefined = this.countries();
    return countries === undefined ? '' : (this.path()(countries) ?? '');
  });

  /**
   * Gets the route, as great-circle arcs between its stops.
   */
  protected readonly route: Signal<string> = computed((): string => {
    const line: LineString = {
      type: 'LineString',
      coordinates: this.stops().map((stop: RouteStop): number[] => [stop.longitude, stop.latitude]),
    };
    return line.coordinates.length < 2 ? '' : (this.path()(line) ?? '');
  });

  /**
   * Gets the markers, one per place.
   */
  protected readonly markers: Signal<readonly RouteMarker[]> = computed(
    (): readonly RouteMarker[] => {
      const projection: GeoProjection = fitProjection(this.stops());
      const places: Map<string, RouteStop[]> = new Map<string, RouteStop[]>();
      for (const stop of this.stops()) {
        const key: string = `${stop.latitude.toFixed(3)},${stop.longitude.toFixed(3)}`;
        places.set(key, [...(places.get(key) ?? []), stop]);
      }
      const lastHop: number | undefined = this.stops().at(-1)?.hop;
      return [...places.entries()].flatMap(([key, stops]: [string, RouteStop[]]): RouteMarker[] => {
        const point: [number, number] | null = projection([stops[0].longitude, stops[0].latitude]);
        if (point === null) {
          return [];
        }
        const hops: string = stops.map((stop: RouteStop): string => String(stop.hop)).join(', ');
        return [
          {
            key,
            x: point[0],
            y: point[1],
            label: hops,
            title: `${stops.length === 1 ? 'Hop' : 'Hops'} ${hops}: ${stops[0].place}`,
            last: stops.some((stop: RouteStop): boolean => stop.hop === lastHop),
          },
        ];
      });
    },
  );

  /**
   * Loads the countries.
   */
  public constructor() {
    void this.loadCountries();
  }

  /**
   * Loads the countries into the map.
   */
  private async loadCountries(): Promise<void> {
    this.countries.set(await loadWorldCountries());
  }
}
