import type { AiConnection, AiDiscoverModelsResult } from '@shared/api/ai-types';
import {
  parseCodexModelsCache,
  runCodexDiscovery,
  type TextFileReader,
} from './codex-model-discovery';

const CONNECTION: AiConnection = {
  id: 'openai-codex',
  kind: 'openai',
  label: 'OpenAI (Codex)',
  auth: 'codex-login',
  models: [{ id: 'stale', label: 'Stale', contextWindow: 1_000 }],
  defaultModelId: 'gpt-5.6-sol',
};

describe('parseCodexModelsCache', () => {
  it('readsVisibleModelsWithRuntimeLabelsAndContextWindows', () => {
    expect(
      parseCodexModelsCache({
        models: [
          {
            slug: 'gpt-5.6-sol',
            display_name: 'GPT-5.6-Sol',
            context_window: 272_000,
            visibility: 'list',
          },
          {
            slug: 'gpt-reserve',
            display_name: 'GPT-Reserve',
            context_window: 272_000,
            visibility: 'hide',
          },
        ],
      }),
    ).toEqual([{ id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', contextWindow: 272_000 }]);
  });

  it('ignoresMalformedAndDuplicateEntries', () => {
    expect(
      parseCodexModelsCache({
        models: [
          null,
          { slug: '', visibility: 'list' },
          { slug: 'luna', visibility: 'list' },
          { slug: 'luna', display_name: 'Duplicate', visibility: 'list' },
        ],
      }),
    ).toEqual([{ id: 'luna', label: 'luna', contextWindow: 32_768 }]);
  });
});

describe('runCodexDiscovery', () => {
  it('replacesStaleModelsFromTheConfiguredCodexHome', async () => {
    const paths: string[] = [];
    const reader: TextFileReader = (path: string): Promise<string> => {
      paths.push(path);
      return Promise.resolve(
        JSON.stringify({
          models: [
            {
              slug: 'gpt-5.6-terra',
              display_name: 'GPT-5.6-Terra',
              context_window: 272_000,
              visibility: 'list',
            },
          ],
        }),
      );
    };

    const result: AiDiscoverModelsResult = await runCodexDiscovery(
      CONNECTION,
      { CODEX_HOME: '/tmp/test-codex' },
      reader,
    );

    expect(paths).toEqual(['/tmp/test-codex/models_cache.json']);
    expect(result.ok).toBe(true);
    expect(result.added).toBe(1);
    expect(result.models).toEqual([
      { id: 'gpt-5.6-terra', label: 'GPT-5.6-Terra', contextWindow: 272_000 },
    ]);
  });

  it('keepsExistingModelsWhenTheCacheCannotBeRead', async () => {
    const reader: TextFileReader = (): Promise<string> => Promise.reject(new Error('missing'));

    const result: AiDiscoverModelsResult = await runCodexDiscovery(CONNECTION, {}, reader);

    expect(result.ok).toBe(false);
    expect(result.models).toBe(CONNECTION.models);
    expect(result.detail).toContain('unavailable');
  });

  it('keepsExistingModelsWhenTheCacheIsInvalid', async () => {
    const reader: TextFileReader = (): Promise<string> => Promise.resolve('{');

    const result: AiDiscoverModelsResult = await runCodexDiscovery(CONNECTION, {}, reader);

    expect(result.ok).toBe(false);
    expect(result.models).toBe(CONNECTION.models);
    expect(result.detail).toContain('not valid JSON');
  });
});
