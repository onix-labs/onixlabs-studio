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
  return `${formatAxisBytes(bytesPerSec)}/s`;
}

/**
 * Formats a size for a chart's axis: like {@link formatBytes}, but a whole number of its unit drops the
 * `.0`, so the ticks read cleanly (`64 GB`, `1.5 MB`).
 * @param bytes The size in bytes.
 * @returns Returns the formatted size.
 */
export function formatAxisBytes(bytes: number): string {
  return formatBytes(bytes).replace(/\.0 /, ' ');
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

/**
 * Formats a span of CPU time compactly, to its two largest units (`12s`, `12m 43s`, `4h 05m`, `3d 4h`).
 * @param seconds The span, in seconds.
 * @returns Returns the formatted span.
 */
export function formatDuration(seconds: number): string {
  const total: number = Math.max(0, Math.floor(seconds));
  const days: number = Math.floor(total / 86_400);
  const hours: number = Math.floor((total % 86_400) / 3600);
  const minutes: number = Math.floor((total % 3600) / 60);
  const rest: number = total % 60;
  const pad: (value: number) => string = (value: number): string => `${value}`.padStart(2, '0');
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${pad(minutes)}m`;
  }
  return minutes > 0 ? `${minutes}m ${pad(rest)}s` : `${rest}s`;
}

/**
 * Formats a count with its thousands grouped (`1,042`, `2,615,981,436`), rounded to a whole number.
 * @param count The count.
 * @returns Returns the formatted count.
 */
export function formatCount(count: number): string {
  return Math.round(count).toLocaleString('en-GB');
}

/**
 * Formats a count for a chart's axis: thousands and millions shortened (`800`, `8K`, `1.5M`).
 * @param count The count.
 * @returns Returns the formatted count.
 */
export function formatAxisCount(count: number): string {
  if (count >= 1_000_000) {
    return `${Number((count / 1_000_000).toFixed(1))}M`;
  }
  return count >= 1000 ? `${Number((count / 1000).toFixed(1))}K` : `${Math.round(count)}`;
}
