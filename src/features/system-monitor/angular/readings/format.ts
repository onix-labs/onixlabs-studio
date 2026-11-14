/**
 * Formats a byte count as a human-readable size.
 * @param bytes The size in bytes.
 * @returns Returns the formatted size (for example `6.1 GB`).
 */
export function formatBytes(bytes: number): string {
  const units: readonly string[] = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size: number = bytes;
  let unit: number = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

/**
 * Formats a per-second byte rate for a chart's axis: like {@link formatRate}, but a whole number of its
 * unit drops the `.0`, so the ticks read cleanly (`128 KB/s`, `1.5 MB/s`).
 * @param bytesPerSec The rate in bytes per second.
 * @returns Returns the formatted throughput.
 */
export function formatAxisRate(bytesPerSec: number): string {
  return formatRate(bytesPerSec).replace(/\.0 /, ' ');
}

/**
 * Formats a per-second byte rate as a human-readable throughput.
 * @param bytesPerSec The rate in bytes per second.
 * @returns Returns the formatted throughput (for example `1.2 MB/s`).
 */
export function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

/**
 * Formats a percentage for a reading, to the nearest whole percent.
 * @param percent The percentage, 0–100.
 * @returns Returns the formatted percentage (for example `42%`).
 */
export function formatPercent(percent: number): string {
  return `${Math.round(percent)}%`;
}

/**
 * Formats a CPU share for a process listing: one decimal place below 10%, where most processes sit
 * and a whole number would read them all as 0 or 1.
 * @param percent The percentage, 0–100.
 * @returns Returns the formatted percentage (for example `3.4%` or `27%`).
 */
export function formatShare(percent: number): string {
  return percent < 10 ? `${percent.toFixed(1)}%` : `${Math.round(percent)}%`;
}
