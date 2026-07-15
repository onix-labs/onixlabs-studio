import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';
import { Breakpoint, Breakpoints } from './breakpoints';

/**
 * A fake settings store backed by an in-memory map, so persistence can be asserted and replayed.
 */
class FakeSettingsStore {
  public readonly values: Map<string, unknown> = new Map<string, unknown>();

  public get<T>(key: string, fallback: T): T {
    return this.values.has(key) ? (this.values.get(key) as T) : fallback;
  }

  public set<T>(key: string, value: T): void {
    this.values.set(key, value);
  }
}

describe('Breakpoints', () => {
  let store: FakeSettingsStore;

  /**
   * Builds the store under test with the fake settings store wired in.
   * @returns Returns the store.
   */
  function build(): Breakpoints {
    TestBed.configureTestingModule({
      providers: [Breakpoints, { provide: SettingsStore, useValue: store }],
    });
    return TestBed.inject(Breakpoints);
  }

  beforeEach(() => {
    store = new FakeSettingsStore();
  });

  it('toggle_addsThenRemoves', () => {
    const breakpoints: Breakpoints = build();
    breakpoints.toggle('/a.ts', 10);
    expect(breakpoints.forPath('/a.ts').map((b) => b.line)).toEqual([10]);
    breakpoints.toggle('/a.ts', 10);
    expect(breakpoints.forPath('/a.ts')).toEqual([]);
  });

  it('add_keepsBreakpointsInAscendingLineOrder', () => {
    const breakpoints: Breakpoints = build();
    breakpoints.add('/a.ts', 30);
    breakpoints.add('/a.ts', 10);
    breakpoints.add('/a.ts', 20);
    expect(breakpoints.forPath('/a.ts').map((b) => b.line)).toEqual([10, 20, 30]);
  });

  it('add_withConditionStoresIt_andReplacesAtSameLine', () => {
    const breakpoints: Breakpoints = build();
    breakpoints.add('/a.ts', 5, { condition: 'x > 1' });
    expect(breakpoints.forPath('/a.ts')[0].condition).toBe('x > 1');
    breakpoints.add('/a.ts', 5, { logMessage: 'hit {x}' });
    expect(breakpoints.forPath('/a.ts')).toHaveLength(1);
    expect(breakpoints.forPath('/a.ts')[0].logMessage).toBe('hit {x}');
  });

  it('add_ignoresNonPositiveLines', () => {
    const breakpoints: Breakpoints = build();
    breakpoints.add('/a.ts', 0);
    expect(breakpoints.forPath('/a.ts')).toEqual([]);
  });

  it('update_changesDefinitionAndClearsVerification', () => {
    const breakpoints: Breakpoints = build();
    breakpoints.add('/a.ts', 5);
    breakpoints.applyVerification('/a.ts', [{ line: 5, verified: true }]);
    expect(breakpoints.forPath('/a.ts')[0].verified).toBe(true);

    breakpoints.update('/a.ts', 5, { condition: 'y == 2', enabled: false });
    const updated: Breakpoint = breakpoints.forPath('/a.ts')[0];
    expect(updated.condition).toBe('y == 2');
    expect(updated.enabled).toBe(false);
    expect(updated.verified).toBe(false);
  });

  it('update_emptyConditionClearsIt', () => {
    const breakpoints: Breakpoints = build();
    breakpoints.add('/a.ts', 5, { condition: 'x' });
    breakpoints.update('/a.ts', 5, { condition: '   ' });
    expect(breakpoints.forPath('/a.ts')[0].condition).toBeUndefined();
  });

  it('remove_dropsTheFileEntryWhenEmpty', () => {
    const breakpoints: Breakpoints = build();
    breakpoints.add('/a.ts', 5);
    breakpoints.remove('/a.ts', 5);
    expect(breakpoints.paths()).toEqual([]);
  });

  it('applyVerification_matchesEnabledBreakpointsByOrder', () => {
    const breakpoints: Breakpoints = build();
    breakpoints.add('/a.ts', 5);
    breakpoints.add('/a.ts', 9);
    breakpoints.update('/a.ts', 5, { enabled: false });

    // Only the enabled breakpoint (line 9) is sent, so the single result maps to it.
    breakpoints.applyVerification('/a.ts', [{ line: 9, verified: true }]);
    const byLine: Map<number, Breakpoint> = new Map<number, Breakpoint>(
      breakpoints.forPath('/a.ts').map((b): [number, Breakpoint] => [b.line, b]),
    );
    expect(byLine.get(9)?.verified).toBe(true);
    expect(byLine.get(5)?.verified).toBe(false);
  });

  it('clearVerification_resetsEveryVerifiedFlag', () => {
    const breakpoints: Breakpoints = build();
    breakpoints.add('/a.ts', 5);
    breakpoints.applyVerification('/a.ts', [{ line: 5, verified: true }]);
    breakpoints.clearVerification();
    expect(breakpoints.forPath('/a.ts')[0].verified).toBe(false);
  });

  it('persistsDefinitionsButNotVerification_andRestores', () => {
    const first: Breakpoints = build();
    first.add('/a.ts', 5, { condition: 'x > 0' });
    first.add('/a.ts', 8, { logMessage: 'log' });
    first.applyVerification('/a.ts', [
      { line: 5, verified: true },
      { line: 8, verified: true },
    ]);

    // A fresh store restoring from the same persistence sees the definitions but no verification.
    TestBed.resetTestingModule();
    const restored: Breakpoints = build();
    const list: readonly Breakpoint[] = restored.forPath('/a.ts');
    expect(list.map((b) => b.line)).toEqual([5, 8]);
    expect(list[0].condition).toBe('x > 0');
    expect(list[1].logMessage).toBe('log');
    expect(list.every((b) => !b.verified)).toBe(true);
  });

  it('restore_ignoresMalformedPersistedEntries', () => {
    store.values.set('debug.breakpoints', {
      '/a.ts': [{ line: 3, enabled: true }, { line: 'nope' }, null, { enabled: true }],
      '/b.ts': 'not-an-array',
    });
    const breakpoints: Breakpoints = build();
    expect(breakpoints.forPath('/a.ts').map((b) => b.line)).toEqual([3]);
    expect(breakpoints.forPath('/b.ts')).toEqual([]);
  });
});
