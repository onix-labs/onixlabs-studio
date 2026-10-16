import type { RunContainerRequest } from './container-types';

/**
 * Reads a run request out of what was sent — by the renderer to main, or by an agent to the
 * Containers view (#969) —, keeping only well-formed parts: an image is
 * required; ports must be whole numbers in range; volumes need a source and a target.
 * @param value What was sent.
 * @returns Returns the request, or null when there is no image.
 */
export function readRunRequest(value: unknown): RunContainerRequest | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const image: unknown = record['image'];
  if (typeof image !== 'string' || image.trim().length === 0) {
    return null;
  }
  const port: (value: unknown) => number | null = (value: unknown): number | null =>
    typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65_536
      ? value
      : null;
  const ports: RunContainerRequest['ports'] = (
    Array.isArray(record['ports']) ? record['ports'] : []
  )
    .map((entry: unknown) =>
      typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {},
    )
    .filter(
      (entry: Record<string, unknown>): boolean =>
        port(entry['host']) !== null && port(entry['container']) !== null,
    )
    .map((entry: Record<string, unknown>) => ({
      host: port(entry['host'])!,
      container: port(entry['container'])!,
      protocol: entry['protocol'] === 'udp' ? ('udp' as const) : ('tcp' as const),
    }));
  const env: Record<string, string> = {};
  if (typeof record['env'] === 'object' && record['env'] !== null) {
    for (const [key, entry] of Object.entries(record['env'] as Record<string, unknown>)) {
      if (key.trim().length > 0 && typeof entry === 'string') {
        env[key.trim()] = entry;
      }
    }
  }
  const volumes: RunContainerRequest['volumes'] = (
    Array.isArray(record['volumes']) ? record['volumes'] : []
  )
    .map((entry: unknown) =>
      typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {},
    )
    .filter(
      (entry: Record<string, unknown>): boolean =>
        typeof entry['source'] === 'string' &&
        entry['source'].trim().length > 0 &&
        typeof entry['target'] === 'string' &&
        entry['target'].startsWith('/'),
    )
    .map((entry: Record<string, unknown>) => ({
      source: String(entry['source']).trim(),
      target: String(entry['target']),
      readOnly: entry['readOnly'] === true,
    }));
  const name: unknown = record['name'];
  return {
    image: image.trim(),
    ...(typeof name === 'string' && name.trim().length > 0 ? { name: name.trim() } : {}),
    ports,
    env,
    volumes,
  };
}
