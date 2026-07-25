import { describe, expect, it } from 'vitest';
import {
  addCheckoutEntry,
  defaultWorktreeConfig,
  isSafeCheckoutId,
  mintCheckoutId,
  parseWorktreeConfig,
  removeCheckoutEntry,
  serializeWorktreeConfig,
  WORKTREE_SCHEMA_VERSION,
  WorktreeConfig,
} from './worktree';

describe('mintCheckoutId', () => {
  it('mintsSafeUniqueIds', () => {
    const first: string = mintCheckoutId();
    const second: string = mintCheckoutId();

    expect(isSafeCheckoutId(first)).toBe(true);
    expect(isSafeCheckoutId(second)).toBe(true);
    expect(first).not.toBe(second);
  });
});

describe('isSafeCheckoutId', () => {
  it('acceptsTheExactUuidShape', () => {
    expect(isSafeCheckoutId('01234567-89ab-cdef-0123-456789abcdef')).toBe(true);
    expect(isSafeCheckoutId('01234567-89AB-CDEF-0123-456789ABCDEF')).toBe(true);
  });

  it('rejectsTraversalSeparatorsAndMalformedValues', () => {
    expect(isSafeCheckoutId('')).toBe(false);
    expect(isSafeCheckoutId('..')).toBe(false);
    expect(isSafeCheckoutId('../evil')).toBe(false);
    expect(isSafeCheckoutId('a/b')).toBe(false);
    expect(isSafeCheckoutId('a\\b')).toBe(false);
    expect(isSafeCheckoutId('not-a-uuid')).toBe(false);
    expect(isSafeCheckoutId(42)).toBe(false);
    expect(isSafeCheckoutId(null)).toBe(false);
  });
});

describe('parseWorktreeConfig', () => {
  it('degradesMalformedInputToAnEmptyLocalOnlyContainer', () => {
    for (const raw of [null, undefined, 'text', 42, []]) {
      const config: WorktreeConfig = parseWorktreeConfig(raw);

      expect(config.version).toBe(WORKTREE_SCHEMA_VERSION);
      expect(config.origin).toBeNull();
      expect(config.checkouts).toEqual([]);
    }
  });

  it('readsOriginCheckoutsAndAliases', () => {
    const id: string = mintCheckoutId();
    const config: WorktreeConfig = parseWorktreeConfig({
      version: 1,
      origin: 'https://example.com/repo.git',
      checkouts: [{ id, alias: 'Task one' }],
    });

    expect(config.origin).toBe('https://example.com/repo.git');
    expect(config.checkouts).toEqual([{ id, alias: 'Task one' }]);
  });

  it('dropsUnsafeIdsAndDuplicates', () => {
    const id: string = mintCheckoutId();
    const config: WorktreeConfig = parseWorktreeConfig({
      checkouts: [
        { id, alias: 'first' },
        { id, alias: 'duplicate' },
        { id: '../evil' },
        { id: '' },
        { alias: 'no id' },
        'not a record',
      ],
    });

    expect(config.checkouts).toEqual([{ id, alias: 'first' }]);
  });

  it('treatsAnEmptyOriginAsLocalOnly', () => {
    expect(parseWorktreeConfig({ origin: '' }).origin).toBeNull();
    expect(parseWorktreeConfig({ origin: 7 }).origin).toBeNull();
  });
});

describe('serializeWorktreeConfig', () => {
  it('roundTripsThroughTheParser', () => {
    const id: string = mintCheckoutId();
    const config: WorktreeConfig = defaultWorktreeConfig('https://example.com/repo.git', [
      { id, alias: 'main line' },
    ]);

    const serialized: string = serializeWorktreeConfig(config);

    expect(serialized.endsWith('\n')).toBe(true);
    expect(parseWorktreeConfig(JSON.parse(serialized))).toEqual(config);
  });
});

describe('addCheckoutEntry', () => {
  it('appendsAndReplacesById', () => {
    const first: string = mintCheckoutId();
    const second: string = mintCheckoutId();
    let config: WorktreeConfig = defaultWorktreeConfig(null);

    config = addCheckoutEntry(config, { id: first });
    config = addCheckoutEntry(config, { id: second, alias: 'two' });
    config = addCheckoutEntry(config, { id: first, alias: 'renamed' });

    expect(config.checkouts).toEqual([
      { id: second, alias: 'two' },
      { id: first, alias: 'renamed' },
    ]);
  });
});

describe('removeCheckoutEntry', () => {
  it('removesByIdAndIgnoresUnknownIds', () => {
    const id: string = mintCheckoutId();
    const config: WorktreeConfig = defaultWorktreeConfig(null, [{ id }]);

    expect(removeCheckoutEntry(config, id).checkouts).toEqual([]);
    expect(removeCheckoutEntry(config, mintCheckoutId()).checkouts).toEqual([{ id }]);
  });
});
