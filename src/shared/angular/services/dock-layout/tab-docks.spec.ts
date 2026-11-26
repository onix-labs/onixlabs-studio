import { TestBed } from '@angular/core/testing';
import { TabDock, TabDocks } from './tab-docks';

describe('TabDocks', () => {
  let docks: TabDocks;
  let calls: string[];

  /**
   * Builds a dock that records what it is asked.
   * @param name The dock's name.
   * @returns Returns the dock.
   */
  function dock(name: string): TabDock {
    return {
      isOpen: (panelId: string): boolean => panelId === name,
      open: (panelId: string): void => void calls.push(`${name} open ${panelId}`),
      close: (panelId: string): void => void calls.push(`${name} close ${panelId}`),
      toggle: (panelId: string): void => void calls.push(`${name} toggle ${panelId}`),
    };
  }

  beforeEach(() => {
    calls = [];
    docks = TestBed.inject(TabDocks);
  });

  it('asksTheDockOfTheTabNamed', () => {
    docks.register('tab-1', dock('one'));
    docks.register('tab-2', dock('two'));

    docks.open('tab-1', 'agent');
    docks.close('tab-2', 'agent');
    docks.toggle('tab-2', 'find');

    expect(calls).toEqual(['one open agent', 'two close agent', 'two toggle find']);
    expect(docks.isOpen('tab-1', 'one')).toBe(true);
    expect(docks.isOpen('tab-2', 'one')).toBe(false);
  });

  it('aTabWithNoDock_hasNothingOpen_andNothingHappensInIt', () => {
    docks.toggle('tab-1', 'agent');
    docks.open(undefined, 'agent');

    expect(calls).toEqual([]);
    expect(docks.isOpen('tab-1', 'agent')).toBe(false);
    expect(docks.isOpen(undefined, 'agent')).toBe(false);
  });

  it('remove_takesTheDockAway_unlessAnotherHasTakenItsPlace', () => {
    const removeFirst: () => void = docks.register('tab-1', dock('one'));
    const removeSecond: () => void = docks.register('tab-1', dock('two'));

    removeFirst();
    expect(docks.isOpen('tab-1', 'two')).toBe(true);

    removeSecond();
    expect(docks.isOpen('tab-1', 'two')).toBe(false);
  });
});
