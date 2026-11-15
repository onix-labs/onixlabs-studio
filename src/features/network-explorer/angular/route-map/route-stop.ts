/**
 * Describes one hop of a route that has a place on the map.
 */
export interface RouteStop {
  /**
   * Gets the hop's number.
   */
  readonly hop: number;

  /**
   * Gets the latitude, in degrees.
   */
  readonly latitude: number;

  /**
   * Gets the longitude, in degrees.
   */
  readonly longitude: number;

  /**
   * Gets the place's name, for its tooltip: a city and country, or whatever is known.
   */
  readonly place: string;
}
