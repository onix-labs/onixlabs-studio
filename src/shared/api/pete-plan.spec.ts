import { describe, expect, it } from 'vitest';
import type { PersonaEntry } from './persona-channels';
import { concernsRuledOut, planPeteChanges, type PetePlan } from './pete-plan';
import type { PeteProposal } from './pete-protocol';

/**
 * Builds an entry.
 * @param id The id.
 * @param patch The fields to change.
 * @returns Returns the entry.
 */
function entry(id: string, patch: Partial<PersonaEntry> = {}): PersonaEntry {
  return {
    id,
    name: id,
    text: `About ${id}.`,
    why: '',
    tags: [],
    links: [],
    scope: { surfaces: [], languages: [] },
    layer: 'memory',
    enabled: true,
    confidence: 0.5,
    confirmed: '',
    author: 'pete',
    locked: false,
    ...patch,
  };
}

/**
 * Plans a proposal against a persona.
 * @param persona The persona.
 * @param proposal The proposal.
 * @param ruledOut The ruled-out topics.
 * @returns Returns the plan.
 */
function plan(
  persona: readonly PersonaEntry[],
  proposal: Partial<PeteProposal>,
  ruledOut: readonly string[] = [],
): PetePlan {
  let next: number = 0;
  return planPeteChanges(
    persona,
    { changes: [], questions: [], ...proposal },
    ruledOut,
    new Date('2026-11-19T12:00:00Z'),
    (): string => `c${String((next += 1))}`,
  );
}

describe('planPeteChanges (#1516)', () => {
  it('add_writesAnUnlockedMemoryByPete_confirmedToday', () => {
    const result: PetePlan = plan([], {
      changes: [
        {
          op: 'add',
          name: 'One recommendation',
          text: 'Prefers a single recommendation to a list of options.',
          tags: ['Preferences', 'decisions'],
          confidence: 0.6,
        },
      ],
    });

    expect(result.refused).toBe(0);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      kind: 'add',
      entryId: 'one-recommendation',
      before: null,
    });
    expect(result.changes[0].after).toMatchObject({
      layer: 'memory',
      author: 'pete',
      locked: false,
      confidence: 0.6,
      confirmed: '2026-11-19',
      tags: ['preferences', 'decisions'],
      links: [],
    });
  });

  it('neverChangesOrRemovesALockedEntry', () => {
    const locked: PersonaEntry = entry('british', { locked: true, author: 'user' });

    const result: PetePlan = plan([locked], {
      changes: [
        { op: 'update', id: 'british', text: 'Writes in American English.' },
        { op: 'remove', id: 'british' },
        { op: 'confirm', id: 'british' },
      ],
    });

    expect(result.changes).toEqual([]);
    expect(result.refused).toBe(3);
  });

  it('neverLearnsARuledOutTopic', () => {
    const result: PetePlan = plan(
      [entry('garden')],
      {
        changes: [
          {
            op: 'add',
            name: 'Health',
            text: 'Has a bad back and sees a physio.',
            tags: ['health'],
          },
          { op: 'update', id: 'garden', text: 'Mentions their physio while gardening.' },
          { op: 'add', name: 'Trains', text: 'Prefers trains.' },
        ],
      },
      ['physio', 'health'],
    );

    expect(result.changes.map((change) => change.entryId)).toEqual(['trains']);
    expect(result.refused).toBe(2);
  });

  it('neverRecordsAPermission', () => {
    const result: PetePlan = plan([], {
      changes: [
        { op: 'add', name: 'Pushing', text: 'Happy for agents to push without asking.' },
        { op: 'add', name: 'Deleting', text: 'Always allow deleting files.' },
      ],
    });

    expect(result.changes).toEqual([]);
    expect(result.refused).toBe(2);
  });

  it('keepsTheCoreWithinItsLimit_byFilingTheOverflowAsAMemory', () => {
    const full: PersonaEntry = entry('rules', {
      layer: 'core',
      text: Array.from(
        { length: 11 },
        (_: unknown, index: number): string => `Rule ${index}.`,
      ).join('\n'),
    });

    const result: PetePlan = plan([full], {
      changes: [{ op: 'add', layer: 'core', name: 'More', text: 'One more.\nAnd another.' }],
    });

    expect(result.changes[0].after?.layer).toBe('memory');
  });

  it('removesSecretsFromWhatItWrites', () => {
    const result: PetePlan = plan([], {
      changes: [
        { op: 'add', name: 'Token', text: 'Uses ghp_abcdefghijklmnopqrstuvwxyz0123 for scripts.' },
      ],
    });

    expect(result.changes[0].after?.text).toBe('Uses [redacted] for scripts.');
  });

  it('confirm_raisesConfidenceAndRenewsTheDate', () => {
    const result: PetePlan = plan([entry('trains', { confidence: 0.5, confirmed: '2026-01-01' })], {
      changes: [{ op: 'confirm', id: 'trains' }],
    });

    expect(result.changes[0].after).toMatchObject({ confidence: 0.7, confirmed: '2026-11-19' });
  });

  it('refusesWhatNamesNoEntry_orHasNothingToSay', () => {
    const result: PetePlan = plan([], {
      changes: [
        { op: 'update', id: 'ghost', text: 'x' },
        { op: 'add', name: '', text: 'No name.' },
      ],
    });

    expect(result.changes).toEqual([]);
    expect(result.refused).toBe(2);
  });

  it('collapsesSeveralChangesToOneEntry_intoOne', () => {
    const result: PetePlan = plan([entry('vague')], {
      changes: [
        { op: 'add', name: 'Dark themes', text: 'Prefers dark colour schemes.' },
        { op: 'update', id: 'dark-themes', why: 'Easier on the eyes at night.' },
        { op: 'remove', id: 'vague', reason: 'Merged into dark-themes.' },
      ],
    });

    expect(result.changes.map((change) => [change.kind, change.entryId])).toEqual([
      ['add', 'dark-themes'],
      ['remove', 'vague'],
    ]);
    expect(result.changes[0].after?.why).toBe('Easier on the eyes at night.');
  });

  it('concernsRuledOut_needsEveryWordOfTheTopic', () => {
    expect(concernsRuledOut('Likes Chinese food', ['chinese food'])).toBe(true);
    expect(concernsRuledOut('Likes food', ['chinese food'])).toBe(false);
  });
});
