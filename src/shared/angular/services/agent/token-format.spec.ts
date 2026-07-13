import { formatCost, formatTokens } from './token-format';

describe('token-format', () => {
  it('formatTokens_belowAThousand_isPlain', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(1)).toBe('1');
    expect(formatTokens(812)).toBe('812');
    expect(formatTokens(999)).toBe('999');
  });

  it('formatTokens_thousands_usesKWithOneTrimmedDecimal', () => {
    expect(formatTokens(1000)).toBe('1k');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(12_345)).toBe('12.3k');
    expect(formatTokens(200_000)).toBe('200k');
  });

  it('formatTokens_millions_usesM', () => {
    expect(formatTokens(1_000_000)).toBe('1M');
    expect(formatTokens(1_240_000)).toBe('1.2M');
  });

  it('formatTokens_negativeOrNonFinite_isZero', () => {
    expect(formatTokens(-5)).toBe('0');
    expect(formatTokens(Number.NaN)).toBe('0');
    expect(formatTokens(Number.POSITIVE_INFINITY)).toBe('0');
  });

  it('formatCost_zeroOrNonFinite_isDollarZero', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(Number.NaN)).toBe('$0.00');
  });

  it('formatCost_subCent_showsFourDecimals', () => {
    expect(formatCost(0.0034)).toBe('$0.0034');
  });

  it('formatCost_centOrMore_showsTwoDecimals', () => {
    expect(formatCost(0.02)).toBe('$0.02');
    expect(formatCost(1.2678)).toBe('$1.27');
  });
});
