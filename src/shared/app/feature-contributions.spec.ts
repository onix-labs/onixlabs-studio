import { describe, expect, it } from 'vitest';
import { FeatureDescriptor } from '@shared/angular/services/feature-registry';
import { featureContributions } from './feature-contributions';

/**
 * Allows for resolving every feature's lazy chunk in one test. These pull in the heaviest graphs the
 * application has — Monaco, xterm, Milkdown — one after another, which does not fit the default
 * five-second budget once coverage instrumentation is in the way, and fits it less on a CI runner than
 * on a developer's machine. Stated here rather than left to flake.
 */
const LOAD_EVERY_FEATURE_TIMEOUT: number = 30_000;

describe('featureContributions', () => {
  it('exposesAtLeastOneLazyContribution', () => {
    expect(featureContributions.length).toBeGreaterThan(0);
  });

  it(
    'eachThunkResolvesToAFeatureDescriptorWithAViewAndType',
    async () => {
      for (const load of featureContributions) {
        const module: { descriptor: FeatureDescriptor } = await load();
        expect(typeof module.descriptor.type).toBe('string');
        expect(module.descriptor.type.length).toBeGreaterThan(0);
        expect(module.descriptor.view).toBeTruthy();
      }
    },
    LOAD_EVERY_FEATURE_TIMEOUT,
  );

  it(
    'contributesTheContainersFeature',
    async () => {
      const types: string[] = [];
      for (const load of featureContributions) {
        types.push((await load()).descriptor.type);
      }
      expect(types).toContain('containers');
    },
    LOAD_EVERY_FEATURE_TIMEOUT,
  );
});
