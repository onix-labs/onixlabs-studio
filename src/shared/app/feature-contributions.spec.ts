import { describe, expect, it } from 'vitest';
import { FeatureDescriptor } from '@shared/angular/services/feature-registry';
import { featureContributions } from './feature-contributions';

describe('featureContributions', () => {
  it('exposesAtLeastOneLazyContribution', () => {
    expect(featureContributions.length).toBeGreaterThan(0);
  });

  it('eachThunkResolvesToAFeatureDescriptorWithAViewAndType', async () => {
    for (const load of featureContributions) {
      const module: { descriptor: FeatureDescriptor } = await load();
      expect(typeof module.descriptor.type).toBe('string');
      expect(module.descriptor.type.length).toBeGreaterThan(0);
      expect(module.descriptor.view).toBeTruthy();
    }
  });

  it('contributesTheContainersFeature', async () => {
    const types: string[] = [];
    for (const load of featureContributions) {
      types.push((await load()).descriptor.type);
    }
    expect(types).toContain('containers');
  });
});
