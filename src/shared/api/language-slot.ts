import { resolveSlot, SlotEntry } from './slot';

// The language-slot contract shared between the Electron main process and the renderer. Keep this
// module platform-neutral (no Node or DOM dependencies) so both compilation targets can import it.
//
// A *slot* is a capability the application defines for a language — serving it with a language server,
// debugging it — that more than one implementation may fill. The application owns the slot; the
// implementations are registered into it, first-party and contributed alike, and the user chooses
// which one fills it. This module holds the part both processes must agree on: how an implementation
// describes itself, and how a choice is resolved from what is registered.

/**
 * Describes one implementation registered into a language slot, as plain data. Carries no provisioning
 * detail — how an implementation is obtained is the main process's business alone — so this is exactly
 * what the renderer needs to resolve a slot and to offer the user the choice.
 */
export interface LanguageSlotEntry extends SlotEntry {
  /**
   * Gets the language identifiers this implementation serves. A language with more than one entry is a
   * slot the user chooses an implementation for.
   */
  readonly languages: readonly string[];
}

/**
 * Gets every registered implementation that serves a language, in registration order.
 * @param language The language identifier.
 * @param entries The registered implementations.
 * @returns Returns the implementations serving the language.
 */
export function entriesForLanguage<T extends LanguageSlotEntry>(
  language: string,
  entries: readonly T[],
): readonly T[] {
  return entries.filter((entry: T): boolean => entry.languages.includes(language));
}

/**
 * Resolves which implementation fills a language's slot: the user's explicit choice when they have
 * made one and it is still registered for that language, otherwise the highest-priority registered
 * implementation, ties broken by registration order. Pure and total — a language nothing serves
 * resolves to null, which is how "unsupported" is expressed.
 *
 * A stale choice (an implementation that has been unregistered, or that never served this language)
 * falls back to the default rather than failing, so removing a plugin cannot strand a language.
 * @param language The language identifier to resolve.
 * @param entries The registered implementations.
 * @param selection The user's chosen implementation per language.
 * @returns Returns the implementation identifier, or null when nothing serves the language.
 */
export function resolveForLanguage<T extends LanguageSlotEntry>(
  language: string,
  entries: readonly T[],
  selection: Readonly<Record<string, string>>,
): string | null {
  return resolveSlot(entriesForLanguage(language, entries), selection[language]);
}
