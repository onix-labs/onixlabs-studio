import { MemorySegment } from './memory-segment';

/**
 * Gets the colour a part of memory wears, as a CSS custom property the Memory view sets, so the
 * breakdown bar, the composition graph and their legends always agree.
 * @param key The part of memory.
 * @returns Returns the colour.
 */
export function memoryColour(key: MemorySegment['key']): string {
  return `var(--memory-${key})`;
}
