import { describe, expect, it } from 'vitest';
import { CatalogModel } from '@shared/api/model-catalog-types';
import {
  HubFetch,
  HubResponse,
  HuggingFaceCatalogSource,
  isGated,
  parameterSizeFromId,
} from './huggingface-catalog-source';

/**
 * A fetch answering with a fixed body, recording the URL it was asked for.
 */
function fetchWith(
  body: unknown,
  ok: boolean = true,
  status: number = 200,
): { http: HubFetch; urls: string[] } {
  const urls: string[] = [];
  const http: HubFetch = (url: string): Promise<HubResponse> => {
    urls.push(url);
    return Promise.resolve({ ok, status, json: (): Promise<unknown> => Promise.resolve(body) });
  };
  return { http, urls };
}

describe('HuggingFaceCatalogSource', () => {
  it('stays quiet for an empty search, leaving the curated list as the default', async () => {
    const { http, urls } = fetchWith([]);

    const models: CatalogModel[] = await new HuggingFaceCatalogSource(http).search({ text: '  ' });

    expect(models).toEqual([]);
    // It must not even reach the network: the curated list is the better empty-state answer.
    expect(urls).toEqual([]);
  });

  it('filters to GGUF and sorts by downloads', async () => {
    const { http, urls } = fetchWith([]);

    await new HuggingFaceCatalogSource(http).search({ text: 'qwen', limit: 7 });

    expect(urls[0]).toContain('filter=gguf');
    expect(urls[0]).toContain('search=qwen');
    expect(urls[0]).toContain('sort=downloads');
    expect(urls[0]).toContain('limit=7');
  });

  it('maps a repo to a pull reference Ollama understands', async () => {
    const { http } = fetchWith([
      { id: 'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF', downloads: 1234 },
    ]);

    const models: CatalogModel[] = await new HuggingFaceCatalogSource(http).search({
      text: 'qwen',
    });

    expect(models[0]).toMatchObject({
      ref: 'hf.co/bartowski/Qwen2.5-Coder-7B-Instruct-GGUF',
      source: 'huggingface',
      downloads: 1234,
      url: 'https://huggingface.co/bartowski/Qwen2.5-Coder-7B-Instruct-GGUF',
    });
  });

  it('reports no size, because the search does not reveal which quantisation is pulled', async () => {
    const { http } = fetchWith([{ id: 'a/b-GGUF', downloads: 1 }]);

    expect((await new HuggingFaceCatalogSource(http).search({ text: 'x' }))[0]?.sizeBytes).toBe(0);
  });

  it('drops gated repos, which would fail to pull without credentials Studio does not hold', async () => {
    const { http } = fetchWith([
      { id: 'open/one-GGUF', downloads: 5 },
      { id: 'gated/two-GGUF', downloads: 9, gated: 'auto' },
      { id: 'gated/three-GGUF', downloads: 9, gated: true },
    ]);

    const models: CatalogModel[] = await new HuggingFaceCatalogSource(http).search({ text: 'x' });

    expect(models.map((m: CatalogModel): string => m.ref)).toEqual(['hf.co/open/one-GGUF']);
  });

  it('drops entries with no id rather than emitting a broken reference', async () => {
    const { http } = fetchWith([{ downloads: 5 }, { id: '', downloads: 5 }]);

    expect(await new HuggingFaceCatalogSource(http).search({ text: 'x' })).toEqual([]);
  });

  it('throws on a non-2xx, so the catalogue can report the source as failed', async () => {
    const { http } = fetchWith([], false, 503);

    await expect(new HuggingFaceCatalogSource(http).search({ text: 'x' })).rejects.toThrow('503');
  });

  it('throws when the body is not a list', async () => {
    const { http } = fetchWith({ error: 'nope' });

    await expect(new HuggingFaceCatalogSource(http).search({ text: 'x' })).rejects.toThrow(
      'unexpected body',
    );
  });
});

describe('isGated', () => {
  it('treats any non-false value as gated, since the Hub names the gate kind', () => {
    expect(isGated({ gated: 'auto' })).toBe(true);
    expect(isGated({ gated: 'manual' })).toBe(true);
    expect(isGated({ gated: true })).toBe(true);
  });

  it('treats absent or false as open', () => {
    expect(isGated({})).toBe(false);
    expect(isGated({ gated: false })).toBe(false);
  });
});

describe('parameterSizeFromId', () => {
  it('reads the parameter count out of the Hub naming convention', () => {
    expect(parameterSizeFromId('bartowski/Qwen2.5-Coder-7B-Instruct-GGUF')).toBe('7B');
    expect(parameterSizeFromId('unsloth/Llama-3.2-1B-Instruct-GGUF')).toBe('1B');
    expect(parameterSizeFromId('someone/model-135M-GGUF')).toBe('135M');
  });

  it('returns nothing when the name does not say, rather than guessing wrong', () => {
    expect(parameterSizeFromId('someone/mystery-GGUF')).toBe('');
  });
});
