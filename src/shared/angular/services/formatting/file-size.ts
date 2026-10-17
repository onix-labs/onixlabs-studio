/**
 * Formats a byte count in the binary units file managers use — shared by the strips that report a
 * file's size (the Image and Binary Editors), so the two read the same.
 * @param bytes The size in bytes.
 * @returns Returns a label such as "812 B", "12.4 KB" or "3.1 MB".
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units: readonly string[] = ['KB', 'MB', 'GB'];
  let value: number = bytes / 1024;
  let unit: number = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
