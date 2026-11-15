/**
 * Formats a per-second byte rate as a human-readable throughput.
 * @param bytesPerSecond The rate in bytes per second.
 * @returns Returns the formatted throughput (for example `1.2 MB/s`).
 */
export function formatRate(bytesPerSecond: number): string {
  const units: readonly string[] = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size: number = bytesPerSecond;
  let unit: number = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}/s`;
}
