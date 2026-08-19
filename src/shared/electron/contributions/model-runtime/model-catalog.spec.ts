import { describe, expect, it } from 'vitest';
import { CatalogModel, CatalogQuery, CatalogResult } from '@shared/api/model-catalog-types';
import { CuratedCatalogSource } from './curated-catalog-source';
import { CURATED_MODELS } from './curated-models';
import { dedupe, ModelCatalog, ModelCatalogSource } from './model-catalog';

/**
 * Builds a catalogue model with the fields a test cares about.
 */
function model(ref: string, source: CatalogModel['source'] = 'curated'): CatalogModel {
  return {
    ref,
    name: ref,
    source,
    category: 'other',
    description: '',
    parameterSize: '',
    sizeBytes: 0,
    downloads: 0,
    url: '',
  };
}

/**
 * A source returning fixed models, or failing.
 */
class FakeSource implements ModelCatalogSource {
  public lastQuery: CatalogQuery | null = null;

  public constructor(
    public readonly id: string,
    private readonly models: CatalogModel[],
    private readonly failure: Error | null = null,
  ) {}

  public search(query: CatalogQuery): Promise<CatalogModel[]> {
    this.lastQuery = query;
    return this.failure === null ? Promise.resolve(this.models) : Promise.reject(this.failure);
  }
}

describe('ModelCatalog', () => {
  it('merges the results of every source', async () => {
    const catalog: ModelCatalog = new ModelCatalog([
      new FakeSource('a', [model('one')]),
      new FakeSource('b', [model('two', 'huggingface')]),
    ]);

    const result: CatalogResult = await catalog.search({ text: '' });

    expect(result.models.map((m: CatalogModel): string => m.ref)).toEqual(['one', 'two']);
    expect(result.failedSources).toEqual([]);
  });

  it('keeps the results of the working source when another fails', async () => {
    const catalog: ModelCatalog = new ModelCatalog([
      new FakeSource('curated', [model('one')]),
      new FakeSource('huggingface', [], new Error('offline')),
    ]);

    const result: CatalogResult = await catalog.search({ text: 'x' });

    // Losing the network must degrade the catalogue, not empty it.
    expect(result.models.map((m: CatalogModel): string => m.ref)).toEqual(['one']);
    expect(result.failedSources).toEqual(['huggingface']);
  });

  it('names every failed source so the view can say the list is partial', async () => {
    const catalog: ModelCatalog = new ModelCatalog([
      new FakeSource('a', [], new Error('boom')),
      new FakeSource('b', [], new Error('boom')),
    ]);

    const result: CatalogResult = await catalog.search({ text: 'x' });

    expect(result.models).toEqual([]);
    expect(result.failedSources).toEqual(['a', 'b']);
  });

  it('passes a default limit down to each source', async () => {
    const source: FakeSource = new FakeSource('a', []);
    await new ModelCatalog([source]).search({ text: 'x' });

    expect(source.lastQuery?.limit).toBeGreaterThan(0);
  });

  it("honours the caller's limit", async () => {
    const source: FakeSource = new FakeSource('a', []);
    await new ModelCatalog([source]).search({ text: 'x', limit: 5 });

    expect(source.lastQuery?.limit).toBe(5);
  });

  it('prefers the earlier source when two offer the same reference', async () => {
    const catalog: ModelCatalog = new ModelCatalog([
      new FakeSource('curated', [model('llama3.2:3b', 'curated')]),
      new FakeSource('huggingface', [model('llama3.2:3b', 'huggingface')]),
    ]);

    const result: CatalogResult = await catalog.search({ text: 'llama' });

    expect(result.models).toHaveLength(1);
    expect(result.models[0]?.source).toBe('curated');
  });
});

describe('dedupe', () => {
  it('removes repeated references, keeping the first', () => {
    expect(dedupe([model('a'), model('b'), model('a')]).map((m) => m.ref)).toEqual(['a', 'b']);
  });

  it('treats references case-insensitively', () => {
    expect(dedupe([model('Llama3.2:3B'), model('llama3.2:3b')])).toHaveLength(1);
  });
});

describe('CuratedCatalogSource', () => {
  it('returns the whole list for an empty search, so the view opens on something browsable', async () => {
    const models: CatalogModel[] = await new CuratedCatalogSource().search({
      text: '',
      limit: 100,
    });

    expect(models.length).toBe(CURATED_MODELS.length);
  });

  it('matches on name, reference and description', async () => {
    const source: CuratedCatalogSource = new CuratedCatalogSource();

    expect((await source.search({ text: 'coder', limit: 100 })).length).toBeGreaterThan(0);
    expect((await source.search({ text: 'llama3.2', limit: 100 })).length).toBeGreaterThan(0);
    expect((await source.search({ text: 'embedding', limit: 100 })).length).toBeGreaterThan(0);
  });

  it('matches case-insensitively', async () => {
    const source: CuratedCatalogSource = new CuratedCatalogSource();

    expect((await source.search({ text: 'QWEN', limit: 100 })).length).toBeGreaterThan(0);
  });

  it('returns nothing for a search that matches nothing', async () => {
    expect(
      await new CuratedCatalogSource().search({ text: 'definitely-not-here', limit: 100 }),
    ).toEqual([]);
  });

  it('honours the limit', async () => {
    expect(await new CuratedCatalogSource().search({ text: '', limit: 3 })).toHaveLength(3);
  });

  it('marks every entry as curated and gives each a usable pull reference', async () => {
    const models: CatalogModel[] = await new CuratedCatalogSource().search({
      text: '',
      limit: 100,
    });

    for (const entry of models) {
      expect(entry.source).toBe('curated');
      // Every curated ref is `name:tag`, which is what the runtime's pull takes unchanged.
      expect(entry.ref).toMatch(/^[a-z0-9._-]+:[a-z0-9._-]+$/i);
      expect(entry.sizeBytes).toBeGreaterThan(0);
    }
  });
});
