// Pure formatting helpers for the agent's token/cost readouts, kept apart from the components so they
// can be unit-tested in isolation.

/**
 * Formats a token count compactly for a tight readout: plain below a thousand, `k` (one decimal, no
 * trailing zero) up to a million, `M` above. Negative or non-finite inputs render as `0`.
 * @param tokens The token count.
 * @returns Returns the compact string (for example, `812`, `12.3k`, `1.2M`).
 */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) {
    return '0';
  }
  if (tokens < 1_000) {
    return `${Math.round(tokens)}`;
  }
  if (tokens < 1_000_000) {
    return `${trimDecimal(tokens / 1_000)}k`;
  }
  return `${trimDecimal(tokens / 1_000_000)}M`;
}

/**
 * Formats a US-dollar cost for the readout, with enough precision to show small per-conversation
 * amounts: sub-cent costs get four decimals, otherwise two. Zero and non-finite inputs render as
 * `$0.00`.
 * @param usd The cost in US dollars.
 * @returns Returns the formatted cost (for example, `$0.00`, `$0.0034`, `$1.27`).
 */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) {
    return '$0.00';
  }
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

/**
 * Renders a value to one decimal place, dropping a trailing `.0`.
 * @param value The value.
 * @returns Returns the trimmed string.
 */
function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}
