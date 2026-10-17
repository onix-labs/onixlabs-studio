import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureDescriptor, FeatureRegistry } from '@shared/angular/services/feature-registry';
import {
  CatalogueBinding,
  KeybindingCatalogueEntry,
} from '@shared/angular/services/keybindings/keybinding-catalogue';
import { Keybindings, ResolvedBinding } from '@shared/angular/services/keybindings/keybindings';
import { featureContributions, registerFeatureContribution } from './feature-contributions';

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

  it(
    'apiExplorerCarriesItsSaveKeybindings',
    async () => {
      const module: { descriptor: FeatureDescriptor } =
        await import('@features/api-explorer/angular/api-explorer.feature');
      const ids: string[] = (module.descriptor.keybindings?.bindings ?? []).map(
        (binding: CatalogueBinding): string => binding.id,
      );
      expect(ids).toEqual(['api.save', 'api.saveAs']);
    },
    LOAD_EVERY_FEATURE_TIMEOUT,
  );
});

describe('registerFeatureContribution', () => {
  let registry: FeatureRegistry;
  let keybindings: Keybindings;

  beforeEach((): void => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(FeatureRegistry);
    keybindings = TestBed.inject(Keybindings);
  });

  it('contributesTheKeybindingsBeforeRegisteringTheDescriptor', (): void => {
    const entry: KeybindingCatalogueEntry = {
      view: 'Lazy',
      bindings: [{ id: 'lazy.save', description: 'Save', chord: 'Mod+S' }],
    };
    const cataloguedAtRegistration: boolean[] = [];
    vi.spyOn(registry, 'register').mockImplementation((): void => {
      cataloguedAtRegistration.push(
        keybindings
          .resolvedCatalogue()
          .some((binding: ResolvedBinding): boolean => binding.id === 'lazy.save'),
      );
    });

    registerFeatureContribution(
      { type: 'lazy', view: class {}, keybindings: entry },
      registry,
      keybindings,
    );

    expect(cataloguedAtRegistration).toEqual([true]);
  });

  it('registersADescriptorWithoutKeybindings', (): void => {
    const contribute: ReturnType<typeof vi.spyOn> = vi.spyOn(keybindings, 'contribute');

    const view: new () => object = class {};
    registerFeatureContribution({ type: 'plain', view }, registry, keybindings);

    expect(contribute).not.toHaveBeenCalled();
    expect(registry.viewFor('plain')).toBe(view);
  });
});
