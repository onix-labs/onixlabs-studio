/**
 * Writes a link or image target so markdown reads all of it as the target. Left bare, a space ends
 * the destination and turns the whole construct back into plain text, and any path under a folder
 * like `Application Support` has one; the angle form is CommonMark's way of carrying them.
 * @param target The URL or path.
 * @returns Returns the destination to write between the parentheses.
 */
export function markdownDestination(target: string): string {
  if (!/[\s()<>]/.test(target)) {
    return target;
  }
  // A backslash left alone would cancel the escape of a bracket after it and close the destination
  // early, and a line break cannot sit between the brackets at all.
  const escaped: string = target
    .replace(/[\\<>]/g, '\\$&')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
  return `<${escaped}>`;
}
