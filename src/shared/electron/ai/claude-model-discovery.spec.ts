import type { AiConnection, AiDiscoverModelsResult, AiModelInfo } from '@shared/api/ai-types';
import {
  type ClaudeSdkModel,
  claudeContextWindow,
  formatClaudeLabel,
  mapClaudeModel,
  mergeClaudeModels,
  parseBracketedContextWindow,
  resolvedVersionLabel,
  runClaudeDiscovery,
  versionFromDescription,
} from './claude-model-discovery';

/**
 * Builds a Claude login connection for the discovery tests.
 * @param models The connection's existing models.
 * @returns Returns the connection.
 */
function connection(models: readonly AiModelInfo[]): AiConnection {
  return {
    id: 'claude',
    kind: 'anthropic',
    label: 'Claude',
    auth: 'claude-login',
    models,
    defaultModelId: models[0]?.id ?? '',
  };
}

const SDK_MODELS: readonly ClaudeSdkModel[] = [
  { value: 'default', resolvedModel: 'claude-opus-5[1m]', displayName: 'Default (recommended)' },
  { value: 'opus[1m]', resolvedModel: 'claude-opus-5[1m]', displayName: 'Opus (1M context)' },
  { value: 'claude-fable-5[1m]', resolvedModel: 'claude-fable-5', displayName: 'Fable' },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet' },
  { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku' },
];

describe('parseBracketedContextWindow', () => {
  it('parseBracketedContextWindow_whenMegaSuffix_returnsMillions', () => {
    expect(parseBracketedContextWindow('claude-opus-5[1m]')).toBe(1_000_000);
  });

  it('parseBracketedContextWindow_whenKiloSuffix_returnsThousands', () => {
    expect(parseBracketedContextWindow('foo[200k]')).toBe(200_000);
  });

  it('parseBracketedContextWindow_whenNoSuffix_returnsNull', () => {
    expect(parseBracketedContextWindow('sonnet')).toBeNull();
  });
});

describe('claudeContextWindow', () => {
  it('claudeContextWindow_whenAliasHasSuffix_usesIt', () => {
    expect(claudeContextWindow({ value: 'opus[1m]', displayName: 'Opus' })).toBe(1_000_000);
  });

  it('claudeContextWindow_whenResolvedHasSuffix_usesIt', () => {
    expect(
      claudeContextWindow({ value: 'default', resolvedModel: 'claude-opus-5[1m]', displayName: 'x' }),
    ).toBe(1_000_000);
  });

  it('claudeContextWindow_whenNoSuffix_fallsBackToHeuristic', () => {
    // No bracket on value or resolved → the id heuristic applies (claude* family).
    const window: number = claudeContextWindow({
      value: 'haiku',
      resolvedModel: 'claude-haiku-4-5-20251001',
      displayName: 'Haiku',
    });
    expect(window).toBeGreaterThan(0);
  });
});

describe('resolvedVersionLabel', () => {
  it('resolvedVersionLabel_stripsSuffixAndPrefixToFamilyVersion', () => {
    expect(resolvedVersionLabel('claude-opus-5[1m]')).toBe('Opus 5');
  });

  it('resolvedVersionLabel_joinsMultiPartVersionWithDots', () => {
    expect(resolvedVersionLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
  });

  it('resolvedVersionLabel_whenNoResolvedModel_returnsNull', () => {
    expect(resolvedVersionLabel(undefined)).toBeNull();
  });

  it('resolvedVersionLabel_whenBareFamily_returnsJustTheFamily', () => {
    expect(resolvedVersionLabel('claude-opus')).toBe('Opus');
  });
});

describe('versionFromDescription', () => {
  it('versionFromDescription_readsLeadingFamilyVersion', () => {
    expect(versionFromDescription('Opus 4.8 with 1M context · Best for everyday tasks')).toBe('Opus 4.8');
    expect(versionFromDescription('Sonnet 4.6 · Efficient for routine tasks')).toBe('Sonnet 4.6');
    expect(versionFromDescription('Fable 5 · Most capable')).toBe('Fable 5');
  });

  it('versionFromDescription_whenNoLeadingVersion_returnsNull', () => {
    expect(versionFromDescription('Fastest for quick answers')).toBeNull();
    expect(versionFromDescription(undefined)).toBeNull();
  });
});

describe('formatClaudeLabel', () => {
  // The SDK-bundled CLI omits resolvedModel but carries the version in the description — the real case.
  it('formatClaudeLabel_fromDescription_foldsVersionIntoPlainFamily', () => {
    expect(
      formatClaudeLabel({ value: 'sonnet', displayName: 'Sonnet', description: 'Sonnet 4.6 · Efficient' }),
    ).toBe('Sonnet 4.6');
  });

  it('formatClaudeLabel_fromDescription_appendsWhenDisplayNameLacksFamily', () => {
    expect(
      formatClaudeLabel({
        value: 'default',
        displayName: 'Default (recommended)',
        description: 'Opus 4.8 with 1M context · Best for everyday tasks',
      }),
    ).toBe('Default (recommended) — Opus 4.8');
  });

  it('formatClaudeLabel_prefersDescriptionOverResolvedModel', () => {
    expect(
      formatClaudeLabel({
        value: 'opus[1m]',
        displayName: 'Opus',
        resolvedModel: 'claude-opus-9',
        description: 'Opus 4.8 with 1M context',
      }),
    ).toBe('Opus 4.8');
  });

  it('formatClaudeLabel_whenPlainFamily_appendsVersion', () => {
    expect(formatClaudeLabel({ value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet' })).toBe(
      'Sonnet 5',
    );
  });

  it('formatClaudeLabel_whenFamilyHasQualifier_insertsVersionAfterFamily', () => {
    expect(
      formatClaudeLabel({
        value: 'opus[1m]',
        resolvedModel: 'claude-opus-5[1m]',
        displayName: 'Opus (1M context)',
      }),
    ).toBe('Opus 5 (1M context)');
  });

  it('formatClaudeLabel_whenDisplayNameLacksFamily_appendsVersion', () => {
    expect(
      formatClaudeLabel({
        value: 'default',
        resolvedModel: 'claude-opus-5[1m]',
        displayName: 'Default (recommended)',
      }),
    ).toBe('Default (recommended) — Opus 5');
  });

  it('formatClaudeLabel_whenNoResolvedModel_usesDisplayNameUnchanged', () => {
    expect(formatClaudeLabel({ value: 'x', displayName: 'Custom Model' })).toBe('Custom Model');
  });
});

describe('mapClaudeModel', () => {
  it('mapClaudeModel_mapsValueToIdAndFoldsVersionIntoLabel', () => {
    expect(mapClaudeModel(SDK_MODELS[2])).toEqual({
      id: 'claude-fable-5[1m]',
      label: 'Fable 5',
      contextWindow: 1_000_000,
    });
  });
});

describe('mergeClaudeModels', () => {
  it('mergeClaudeModels_refreshesLabelAndWindowButKeepsUserFlags', () => {
    const existing: readonly AiModelInfo[] = [
      { id: 'sonnet', label: 'Sonnet', contextWindow: 999, pinned: true },
    ];
    const discovered: readonly AiModelInfo[] = [
      { id: 'sonnet', label: 'Sonnet 5', contextWindow: 1_000_000 },
      { id: 'haiku', label: 'Haiku 4.5', contextWindow: 200_000 },
    ];

    const merged: AiModelInfo[] = mergeClaudeModels(existing, discovered);

    // Re-discovered 'sonnet' has its label/window refreshed but its pin kept; 'haiku' is appended.
    expect(merged).toEqual([
      { id: 'sonnet', label: 'Sonnet 5', contextWindow: 1_000_000, pinned: true },
      { id: 'haiku', label: 'Haiku 4.5', contextWindow: 200_000 },
    ]);
  });

  it('mergeClaudeModels_leavesUndiscoveredManualEntriesUntouched', () => {
    const existing: readonly AiModelInfo[] = [
      { id: 'my-custom', label: 'my-custom', contextWindow: 32_768 },
    ];
    const discovered: readonly AiModelInfo[] = [{ id: 'sonnet', label: 'Sonnet 5', contextWindow: 1_000_000 }];

    const merged: AiModelInfo[] = mergeClaudeModels(existing, discovered);

    expect(merged).toEqual([
      { id: 'my-custom', label: 'my-custom', contextWindow: 32_768 },
      { id: 'sonnet', label: 'Sonnet 5', contextWindow: 1_000_000 },
    ]);
  });
});

describe('runClaudeDiscovery', () => {
  it('runClaudeDiscovery_whenModelsReturned_mergesAndReportsAdded', async () => {
    const result: AiDiscoverModelsResult = await runClaudeDiscovery(connection([]), () =>
      Promise.resolve(SDK_MODELS),
    );

    expect(result.ok).toBe(true);
    expect(result.added).toBe(5);
    expect(result.models.map((model: AiModelInfo): string => model.id)).toEqual([
      'default',
      'opus[1m]',
      'claude-fable-5[1m]',
      'sonnet',
      'haiku',
    ]);
    expect(result.detail).toContain('added 5 new');
  });

  it('runClaudeDiscovery_whenNothingNew_reportsZeroAdded', async () => {
    const existing: readonly AiModelInfo[] = SDK_MODELS.map(mapClaudeModel);

    const result: AiDiscoverModelsResult = await runClaudeDiscovery(connection(existing), () =>
      Promise.resolve(SDK_MODELS),
    );

    expect(result.ok).toBe(true);
    expect(result.added).toBe(0);
    expect(result.detail).toContain('nothing new');
  });

  it('runClaudeDiscovery_whenEmpty_failsAndKeepsExisting', async () => {
    const existing: readonly AiModelInfo[] = [{ id: 'x', label: 'X', contextWindow: 1 }];

    const result: AiDiscoverModelsResult = await runClaudeDiscovery(connection(existing), () =>
      Promise.resolve([]),
    );

    expect(result.ok).toBe(false);
    expect(result.added).toBe(0);
    expect(result.models).toEqual(existing);
  });

  it('runClaudeDiscovery_whenListingThrows_failsGracefully', async () => {
    const existing: readonly AiModelInfo[] = [{ id: 'x', label: 'X', contextWindow: 1 }];

    const result: AiDiscoverModelsResult = await runClaudeDiscovery(connection(existing), () =>
      Promise.reject(new Error('harness unavailable')),
    );

    expect(result.ok).toBe(false);
    expect(result.models).toEqual(existing);
    expect(result.detail).toContain('Could not ask Claude');
  });
});
