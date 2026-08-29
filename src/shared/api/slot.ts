// The slot contract shared between the Electron main process and the renderer. Keep this module
// platform-neutral (no Node or DOM dependencies) so both compilation targets can import it.
//
// A *slot* is a capability the application defines that more than one implementation may fill. The
// application owns the slot; implementations are registered into it, first-party and contributed
// alike, and the user chooses which one fills it.
//
// Slots differ in what they are keyed by. A language server or a debug adapter is chosen *per
// language* — Python may be served by one thing and Rust by another. A container engine is chosen
// once for the application: there is no key, because there is nothing to vary it by. That difference
// is the reason this module and `language-slot.ts` are separate: the general shape is an identity, a
// name and a priority, and keying is a specialisation on top of it rather than part of it.

/**
 * Describes one implementation registered into a slot, as plain data. Carries no provisioning
 * detail — how an implementation is obtained is the main process's business alone.
 */
export interface SlotEntry {
  /**
   * Gets the stable identifier the implementation is named by.
   */
  readonly id: string;

  /**
   * Gets the display name shown when choosing which implementation fills the slot.
   */
  readonly displayName: string;

  /**
   * Gets the priority used to pick a default when the user has expressed no preference, higher first.
   * Ties break on registration order, so a deterministic default always exists.
   */
  readonly priority: number;
}

/**
 * Resolves which implementation fills a slot: the user's explicit choice when they have made one and
 * it is still among the candidates, otherwise the highest-priority candidate, ties broken by
 * registration order. Pure and total — no candidates resolves to null.
 *
 * A stale choice (an implementation that has been unregistered, or that is no longer usable here)
 * falls back to the default rather than failing, so losing one cannot strand the slot.
 * @param candidates The implementations eligible to fill the slot.
 * @param chosen The user's chosen implementation, or undefined when they have expressed no preference.
 * @returns Returns the implementation identifier, or null when there are no candidates.
 */
export function resolveSlot<T extends SlotEntry>(
  candidates: readonly T[],
  chosen: string | undefined,
): string | null {
  if (candidates.length === 0) {
    return null;
  }
  if (chosen !== undefined && candidates.some((entry: T): boolean => entry.id === chosen)) {
    return chosen;
  }
  // Strictly-greater keeps the earliest candidate on equal priority, so the default follows
  // registration order rather than which implementation happened to register first.
  return candidates.reduce((best: T, entry: T): T =>
    entry.priority > best.priority ? entry : best,
  ).id;
}
