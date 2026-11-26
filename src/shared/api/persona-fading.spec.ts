import { describe, expect, it } from 'vitest';
import type { PersonaEntry } from './persona-channels';
import { fadeEntries } from './persona-fading';
import type { PersonaChange } from './persona-learning-protocol';

/**
 * Builds a learned memory.
 * @param id The id.
 * @param patch The fields to change.
 * @returns Returns the entry.
 */
function learned(id: string, patch: Partial<PersonaEntry> = {}): PersonaEntry {
  return {
    id,
    name: id,
    text: 'x',
    why: '',
    tags: [],
    links: [],
    scope: { surfaces: [], languages: [] },
    layer: 'memory',
    enabled: true,
    confidence: 0.6,
    confirmed: '2026-01-01',
    author: 'learned',
    locked: false,
    ...patch,
  };
}

/**
 * Fades as of a day.
 * @param entries The persona.
 * @param day The day.
 * @param lastFaded When fading last ran.
 * @returns Returns the changes.
 */
function fadeOn(
  entries: readonly PersonaEntry[],
  day: string,
  lastFaded: number = 0,
): readonly PersonaChange[] {
  let next: number = 0;
  return fadeEntries(
    entries,
    lastFaded,
    Date.parse(`${day}T00:00:00Z`),
    (): string => `f${String((next += 1))}`,
  );
}

describe('fadeEntries (#1519)', () => {
  it('leavesAnEntryAloneForTheQuietPeriod', () => {
    expect(fadeOn([learned('a')], '2026-02-15')).toEqual([]);
  });

  it('afterThat_takesATenthOffEachMonth', () => {
    // Quiet until 2 March; 30 days later it has lost a tenth.
    const [change] = fadeOn([learned('a')], '2026-04-01');

    expect(change.after?.confidence).toBe(0.5);
    expect(change.after?.enabled).toBe(true);
    expect(change.reason).toBe('Less certain: not seen since 2026-01-01.');
  });

  it('belowTheFloor_switchesItOff_ratherThanDeletingIt', () => {
    const [change] = fadeOn([learned('a', { confidence: 0.25 })], '2026-04-01');

    expect(change.after).toMatchObject({ confidence: 0.15, enabled: false });
    expect(change.reason).toContain('Switched off');
  });

  it('countsOnlyTheTimeSinceItLastRan', () => {
    const lastFaded: number = Date.parse('2026-04-01T00:00:00Z');

    expect(fadeOn([learned('a', { confidence: 0.5 })], '2026-04-01', lastFaded)).toEqual([]);
    expect(
      fadeOn([learned('a', { confidence: 0.5 })], '2026-05-01', lastFaded)[0].after?.confidence,
    ).toBe(0.4);
  });

  it('neverFadesWhatTheUserWroteOrLocked_orWhatIsAlreadyOff', () => {
    expect(
      fadeOn(
        [
          learned('mine', { author: 'user' }),
          learned('locked', { locked: true }),
          learned('off', { enabled: false }),
        ],
        '2027-01-01',
      ),
    ).toEqual([]);
  });

  it('aConfirmationRenewsTheQuietPeriod', () => {
    expect(fadeOn([learned('a', { confirmed: '2026-03-20' })], '2026-04-01')).toEqual([]);
  });
});
