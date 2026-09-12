// What Studio needs to know about an Anthropic model that the Agent SDK does not report: its context
// window, and a label carrying the version.
//
// ⛔ This knowledge belongs here and nowhere else (#653). Core used to hold a table of `claude-opus-4-8`
// and friends, which meant it could never stop knowing which models Anthropic has — so the table moved
// to the plugin that is already talking to Anthropic, and the window rides the reported model
// (agent protocol 1.10.0).

/**
 * The context window Anthropic's models carry unless the id says otherwise.
 *
 * A family floor rather than a per-model table: the exact figure for a given generation changes without
 * the family changing, and a floor that is occasionally low shows a conversation as fuller than it is —
 * visible and correctable — where a ceiling that is too high hides that a turn is about to overflow.
 */
const FAMILY_CONTEXT_WINDOW: number = 200_000;

/**
 * Resolves a model's context window from its identifiers.
 *
 * The SDK marks an extended-context variant with a bracketed hint — `opus[1m]`, `claude-fable-5-1[1m]` —
 * and reports nothing else about capacity, so that hint is the only thing distinguishing a 1M model from
 * a 200K one. Without it every Claude model read as the 32K default, which showed a 1M conversation as
 * full at three percent of its capacity (#697).
 * @param value The id the SDK is asked to run.
 * @param resolved The canonical model the id resolves to, when the SDK reported one.
 * @returns Returns the context window in tokens.
 */
export function contextWindowFor(value: string, resolved?: string): number {
  const text: string = `${value} ${resolved ?? ''}`.toLowerCase();
  const hint: RegExpExecArray | null = /\[(\d+)([km])\]/.exec(text);
  if (hint !== null) {
    const size: number = Number(hint[1]);
    return hint[2] === 'm' ? size * 1_000_000 : size * 1_000;
  }
  return FAMILY_CONTEXT_WINDOW;
}

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
