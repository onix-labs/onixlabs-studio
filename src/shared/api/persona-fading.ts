import type { PersonaEntry } from './persona-channels';
import type { PersonaChange } from './persona-learning-protocol';

// Fading (#1519): a learned entry that is never confirmed again grows less certain over time, and one
// that has faded far enough is switched off rather than deleted, so it can be switched back on. Seeing
// it again (learning confirms it, or the user presses Confirm) renews it. Entries the user wrote, and
// locked ones, never fade: the user said so, and that does not go stale.
// Keep this module platform-neutral (types and pure functions only).

/**
 * How long an entry stays as certain as it was after it was last confirmed, in days.
 */
export const FADE_AFTER_DAYS: number = 60;

/**
 * How much confidence an unconfirmed entry loses each 30 days after that.
 */
export const FADE_PER_MONTH: number = 0.1;

/**
 * The confidence below which a faded entry is switched off.
 */
export const FADE_FLOOR: number = 0.2;

/**
 * A day, in milliseconds.
 */
const DAY_MS: number = 24 * 60 * 60_000;

/**
 * Makes ids for changes; injected so a test can predict them.
 */
export type FadeIdSource = () => string;

/**
 * Fades the learned entries that have gone unconfirmed, for the time since fading last ran.
 *
 * Fading is measured from whichever is later: when fading last ran, or when the entry's quiet period
 * ended. So running it twice in a day takes off nothing the second time, and an entry confirmed
 * yesterday is not charged for the months before.
 * @param entries The persona.
 * @param lastFaded When fading last ran (epoch milliseconds), or 0 for never.
 * @param now The moment.
 * @param nextId Makes change ids.
 * @returns Returns the changes to make: lower confidence, and switched off below the floor.
 */
export function fadeEntries(
  entries: readonly PersonaEntry[],
  lastFaded: number,
  now: number,
  nextId: FadeIdSource,
): readonly PersonaChange[] {
  const changes: PersonaChange[] = [];
  for (const entry of entries) {
    if (entry.author !== 'learned' || entry.locked || !entry.enabled || entry.confirmed === '') {
      continue;
    }
    const confirmed: number = Date.parse(`${entry.confirmed}T00:00:00Z`);
    if (Number.isNaN(confirmed)) {
      continue;
    }
    const quietEnds: number = confirmed + FADE_AFTER_DAYS * DAY_MS;
    const from: number = Math.max(lastFaded, quietEnds);
    if (now <= from) {
      continue;
    }
    const lost: number = ((now - from) / (30 * DAY_MS)) * FADE_PER_MONTH;
    const confidence: number = Math.max(0, Math.round((entry.confidence - lost) * 100) / 100);
    if (confidence === entry.confidence) {
      continue;
    }
    const off: boolean = confidence < FADE_FLOOR;
    changes.push({
      id: nextId(),
      at: now,
      kind: 'change',
      entryId: entry.id,
      before: entry,
      after: { ...entry, confidence, enabled: !off },
      reason: off
        ? `Switched off: not seen since ${entry.confirmed}.`
        : `Less certain: not seen since ${entry.confirmed}.`,
    });
  }
  return changes;
}
