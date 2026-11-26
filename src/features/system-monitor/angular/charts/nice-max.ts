/**
 * The multipliers a decimal scale's top may land on, so its quarter ticks read cleanly.
 */
const DECIMAL_STEPS: readonly number[] = [1, 2, 4, 5, 8, 10];

/**
 * The multipliers a binary (bytes) scale's top may land on: powers of two, so its quarter ticks are
 * whole numbers of the unit (256 KB, 512 KB, 768 KB, 1 MB).
 */
const BINARY_STEPS: readonly number[] = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];

/**
 * Works out a chart scale's top: the least clean number at or above the peak, so the axis's quarter
 * ticks are round.
 * @param peak The largest value the chart draws.
 * @param base The scale's base: 10 for plain numbers, 1024 for bytes.
 * @param floor The least the top may be, so a flat-lined chart still has a scale.
 * @returns Returns the scale's top.
 */
export function niceMax(peak: number, base: 10 | 1024, floor: number): number {
  const target: number = Math.max(peak, floor);
  if (!Number.isFinite(target) || target <= 0) {
    return 1;
  }
  const unit: number = base ** Math.floor(Math.log(target) / Math.log(base));
  const steps: readonly number[] = base === 10 ? DECIMAL_STEPS : BINARY_STEPS;
  const step: number =
    steps.find((candidate: number): boolean => candidate * unit >= target) ?? base;
  return step * unit;
}
