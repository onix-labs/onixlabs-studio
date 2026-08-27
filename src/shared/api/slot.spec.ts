import { describe, expect, it } from 'vitest';
import { resolveSlot, SlotEntry } from './slot';

/**
 * Builds a slot entry for the tests.
 * @param id The entry identifier.
 * @param priority The entry priority.
 * @returns Returns the entry.
 */
function entry(id: string, priority: number): SlotEntry {
  return { id, displayName: id, priority };
}

describe('resolveSlot', (): void => {
  const docker: SlotEntry = entry('docker', 100);
  const podman: SlotEntry = entry('podman', 50);

  it('picksTheHighestPriorityWhenNothingIsChosen', (): void => {
    expect(resolveSlot([docker, podman], undefined)).toBe('docker');
  });

  it('honoursTheChoiceOverThePriority', (): void => {
    expect(resolveSlot([docker, podman], 'podman')).toBe('podman');
  });

  it('fallsBackWhenTheChoiceIsNoLongerACandidate', (): void => {
    // The chosen engine stopped being available — uninstalled, or its socket went away. Falling back
    // beats failing: the surface still works, with whatever is actually there.
    expect(resolveSlot([docker], 'podman')).toBe('docker');
  });

  it('resolvesTheOnlyCandidateWhicheverItIs', (): void => {
    expect(resolveSlot([podman], undefined)).toBe('podman');
  });

  it('resolvesToNullWhenThereAreNoCandidates', (): void => {
    expect(resolveSlot([], 'docker')).toBeNull();
  });

  it('breaksAPriorityTieOnRegistrationOrder', (): void => {
    const first: SlotEntry = entry('first', 100);
    const second: SlotEntry = entry('second', 100);

    expect(resolveSlot([first, second], undefined)).toBe('first');
    expect(resolveSlot([second, first], undefined)).toBe('second');
  });
});
