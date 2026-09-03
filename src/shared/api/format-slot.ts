import { resolveSlot, SlotEntry } from './slot';

// The format-slot contract shared between the Electron main process and the renderer. Keep this module
// platform-neutral (no Node or DOM dependencies) so both compilation targets can import it.
//
// A *format* slot is a capability the application defines for a binary format — decoding it into a
// listing — that more than one implementation may fill. It is the third keying of the slot model, and
// exists for the same reason `language-slot.ts` does: the general shape is an identity, a name and a
// priority, and keying is a specialisation on top of it. A language server is chosen per language; a
// decoder is chosen per *format*, because what decodes a JVM class file has nothing to say about a
// Mach-O binary.

/**
 * Describes one implementation registered into a format slot, as plain data. Carries no provisioning
 * detail — how an implementation is obtained is the main process's business alone — so this is exactly
 * what the renderer needs to resolve a slot and to offer the user the choice.
 */
export interface FormatSlotEntry extends SlotEntry {
  /**
   * Gets the format keys this implementation decodes. A format with more than one entry is a slot the
   * user chooses an implementation for.
   */
  readonly formats: readonly string[];
}

/**
 * Gets every registered implementation that decodes a format, in registration order.
 * @param format The format key.
 * @param entries The registered implementations.
 * @returns Returns the implementations decoding the format.
 */
export function entriesForFormat<T extends FormatSlotEntry>(
  format: string,
  entries: readonly T[],
): readonly T[] {
  return entries.filter((entry: T): boolean => entry.formats.includes(format));
}

/**
 * Resolves which implementation fills a format's slot: the user's explicit choice when they have made
 * one and it is still registered for that format, otherwise the highest-priority registered
 * implementation, ties broken by registration order. Pure and total — a format nothing decodes resolves
 * to null, which is how "no decoder installed" is expressed.
 *
 * A stale choice (an implementation that has been unregistered, or that never decoded this format)
 * falls back to the default rather than failing, so uninstalling a plugin cannot strand a format.
 * @param format The format key to resolve.
 * @param entries The registered implementations.
 * @param selection The user's chosen implementation per format.
 * @returns Returns the implementation identifier, or null when nothing decodes the format.
 */
export function resolveForFormat<T extends FormatSlotEntry>(
  format: string,
  entries: readonly T[],
  selection: Readonly<Record<string, string>>,
): string | null {
  return resolveSlot(entriesForFormat(format, entries), selection[format]);
}
