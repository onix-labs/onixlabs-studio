import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCodexModels, readCodexModels } from './codex-models';

describe('parseCodexModels', () => {
  it('takesTheModelsTheCliListsForTheAccount_skippingHiddenOnes', () => {
    // The shape the CLI writes, trimmed: `hide` marks internal and compatibility models.
    const cache: unknown = {
      fetched_at: '2026-10-07T00:12:10Z',
      models: [
        { slug: 'gpt-reserve', display_name: 'GPT-Reserve', visibility: 'hide' },
        {
          slug: 'gpt-5.6-terra',
          display_name: 'GPT-5.6-Terra',
          visibility: 'list',
          context_window: 272000,
        },
        { slug: 'gpt-5.6-luna', display_name: 'GPT-5.6-Luna', visibility: 'list' },
      ],
    };

    expect(parseCodexModels(cache)).toEqual([
      { id: 'gpt-5.6-terra', label: 'GPT-5.6-Terra', contextWindow: 272000 },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6-Luna' },
    ]);
  });

  it('readsAnythingUnexpectedAsNoModels', () => {
    // The cache is the CLI's own, not a published format.
    expect(parseCodexModels(null)).toEqual([]);
    expect(parseCodexModels({ models: 'many' })).toEqual([]);
    expect(parseCodexModels({ models: [null, { slug: 7, visibility: 'list' }] })).toEqual([]);
  });
});

describe('readCodexModels', () => {
  let home: string | null = null;

  afterEach(() => {
    if (home !== null) {
      rmSync(home, { recursive: true, force: true });
      home = null;
    }
  });

  it('readsTheCacheUnderTheCodexHome', async () => {
    home = mkdtempSync(join(tmpdir(), 'codex-home-'));
    writeFileSync(
      join(home, 'models_cache.json'),
      JSON.stringify({ models: [{ slug: 'gpt-5.6-terra', visibility: 'list' }] }),
    );

    expect(await readCodexModels(home)).toEqual({ models: [{ id: 'gpt-5.6-terra' }] });
  });

  it('saysWhyThereAreNone_whenThereIsNoCache', async () => {
    home = mkdtempSync(join(tmpdir(), 'codex-home-'));

    const found: { models: readonly unknown[]; detail?: string } = await readCodexModels(home);

    expect(found.models).toEqual([]);
    expect(found.detail).toContain('Run a Codex turn');
  });

  it('saysWhyThereAreNone_whenTheCacheIsNotJson', async () => {
    home = mkdtempSync(join(tmpdir(), 'codex-home-'));
    writeFileSync(join(home, 'models_cache.json'), '{not json');

    expect(await readCodexModels(home)).toEqual({
      models: [],
      detail: "Codex's list of models could not be read.",
    });
  });
});
