import type { FeatureCollection } from 'geojson';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';

/**
 * Holds the countries once loaded, so every map shares one copy.
 */
let loaded: Promise<FeatureCollection> | undefined;

/**
 * Loads the world's country outlines: Natural Earth's public-domain 1:110m countries, as the
 * `world-atlas` package ships them. Imported on first use, so the outlines land in their own chunk
 * and cost nothing until a route is mapped.
 * @returns Returns a promise resolving the countries.
 */
export function loadWorldCountries(): Promise<FeatureCollection> {
  loaded ??= import('world-atlas/countries-110m.json').then(
    (module: { default: unknown }): FeatureCollection => {
      const topology: Topology<{ countries: GeometryCollection }> = module.default as Topology<{
        countries: GeometryCollection;
      }>;
      return feature(topology, topology.objects.countries);
    },
  );
  return loaded;
}
