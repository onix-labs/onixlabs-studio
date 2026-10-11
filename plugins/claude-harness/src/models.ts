// What Studio needs to know about an Anthropic model that the Agent SDK does not report: a label
// carrying the version.
//
// ⛔ Not its context window. The SDK's model list states none, and this file used to infer one — a
// `[1m]` hint in the id, else a 200K family floor — which turned into every model reading 200K once the
// CLI stopped tagging its 1M models. An inferred window is a guess, and Studio shows none rather than a
// guess (agent protocol 1.13.0).

/**
 * Builds the label shown in the model picker, adding the version when the SDK's display name omits it.
 *
 * The SDK names the *alias* rather than the model — `sonnet` displays as "Sonnet", `haiku` as "Haiku" —
 * so a picker built from display names alone cannot tell Sonnet 5 from its predecessor. The canonical
 * id carries the version, so it is folded in: `claude-sonnet-5` makes "Sonnet 5",
 * `claude-haiku-4-5-20251001` makes "Haiku 4.5".
 *
 * ⚠️ A display name that already carries a digit is left alone. "Opus (1M context)" is naming the
 * variant, not the version, but appending to it reads worse than the small ambiguity it removes.
 * @param displayName The SDK's display name.
 * @param resolved The canonical model the id resolves to, when the SDK reported one.
 * @returns Returns the label.
 */
export function labelFor(displayName: string, resolved?: string): string {
  if (resolved === undefined || /\d/.test(displayName)) {
    return displayName;
  }
  const version: string | null = versionOf(resolved);
  if (version === null) {
    return displayName;
  }
  // `Sonnet` + `Sonnet 5` reads as `Sonnet 5`, not `Sonnet (Sonnet 5)`. The display name usually *is*
  // the family, so the version replaces that word rather than trailing it — and anything the SDK put
  // after the family ("Sonnet (fast)") is kept.
  const family: string = version.split(' ')[0];
  if (displayName.toLowerCase().startsWith(family.toLowerCase())) {
    return `${version}${displayName.slice(family.length)}`;
  }
  return `${displayName} · ${version}`;
}

/**
 * Reads the family and version out of a canonical model id.
 * @param resolved The canonical model id, such as `claude-haiku-4-5-20251001`.
 * @returns Returns a phrase such as `Haiku 4.5`, or null when the id is not shaped like one.
 */
function versionOf(resolved: string): string | null {
  // `claude-haiku-4-5-20251001[1m]` -> `haiku-4-5`: drop the prefix, the bracketed hint, and a trailing
  // release date, which is a build stamp rather than a version anybody says out loud.
  const bare: string = resolved
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, '')
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '');
  const parts: readonly string[] = bare.split('-');
  const family: string | undefined = parts[0];
  const digits: readonly string[] = parts
    .slice(1)
    .filter((part: string): boolean => /^\d+$/.test(part));
  if (family === undefined || family.length === 0 || digits.length === 0) {
    return null;
  }
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${digits.join('.')}`;
}
