import { describe, expect, it } from 'vitest';
import { coreLineCount, PERSONA_CORE_LINE_LIMIT, type PersonaEntry } from './persona-channels';
import { fadeEntries } from './persona-fading';
import { planLearningChanges, type LearningPlan } from './persona-learning-plan';
import type { PersonaChange } from './persona-learning-protocol';

/**
 * Applies changes to a persona.
 * @param entries The persona.
 * @param changes The changes.
 * @returns Returns the persona after them.
 */
function apply(
  entries: readonly PersonaEntry[],
  changes: readonly PersonaChange[],
): readonly PersonaEntry[] {
  const byId: Map<string, PersonaEntry> = new Map<string, PersonaEntry>(
    entries.map((entry: PersonaEntry): [string, PersonaEntry] => [entry.id, entry]),
  );
  for (const change of changes) {
    if (change.after === null) {
      byId.delete(change.entryId);
    } else {
      byId.set(change.entryId, change.after);
    }
  }
  return [...byId.values()];
}

describe('a persona grown over months (#1519, done when)', () => {
  it('keepsTheCoreWithinItsLimit_andSwitchesOffWhatIsNeverSeenAgain', () => {
    let persona: readonly PersonaEntry[] = [];
    let next: number = 0;
    const id: () => string = (): string => `c${String((next += 1))}`;
    const start: number = Date.parse('2026-01-01T00:00:00Z');
    let lastFaded: number = 0;
    // A run every three days for six months. Each one tries to put a new rule in the core, and confirms
    // the one preference that keeps coming up; everything else is said once and never again.
    for (let day: number = 0; day < 180; day += 3) {
      const now: Date = new Date(start + day * 24 * 60 * 60_000);
      const recurring: PersonaEntry | undefined = persona.find(
        (entry: PersonaEntry): boolean => entry.name === 'One recommendation',
      );
      const plan: LearningPlan = planLearningChanges(
        persona,
        {
          changes: [
            {
              op: 'add',
              layer: 'core',
              name: `Rule ${day}`,
              text: `Rule from day ${day}.\nAnd a second line.`,
            },
            recurring === undefined
              ? {
                  op: 'add',
                  name: 'One recommendation',
                  text: 'Prefers one recommendation.',
                  tags: ['preferences'],
                }
              : { op: 'confirm', id: recurring.id },
          ],
          questions: [],
        },
        [],
        now,
        id,
      );
      persona = apply(persona, plan.changes);
      persona = apply(persona, fadeEntries(persona, lastFaded, now.getTime(), id));
      lastFaded = now.getTime();

      expect(coreLineCount(persona)).toBeLessThanOrEqual(PERSONA_CORE_LINE_LIMIT);
    }

    const stillOn: readonly PersonaEntry[] = persona.filter(
      (entry: PersonaEntry): boolean => entry.enabled,
    );
    // The preference that kept coming up is certain and on; the one-offs from the first months have
    // faded and been switched off, so what is in use is what has been confirmed lately.
    expect(
      stillOn.find((entry: PersonaEntry): boolean => entry.name === 'One recommendation')
        ?.confidence,
    ).toBe(1);
    expect(persona.find((entry: PersonaEntry): boolean => entry.name === 'Rule 0')?.enabled).toBe(
      false,
    );
    expect(stillOn.length).toBeLessThan(persona.length);
  });
});
