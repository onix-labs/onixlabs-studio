/**
 * Describes one part of the machine's memory: what holds it, and how much.
 */
export interface MemorySegment {
  /**
   * Gets the part (`app`, `wired`, `compressed`, `cached`, `free`), which keys its colour.
   */
  readonly key: 'app' | 'wired' | 'compressed' | 'cached' | 'free';

  /**
   * Gets the part's name (`Apps`).
   */
  readonly label: string;

  /**
   * Gets the part's size, in bytes.
   */
  readonly bytes: number;
}
