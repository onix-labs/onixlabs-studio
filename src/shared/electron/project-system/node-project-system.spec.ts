import { NodeProjectSystem, parseManifestActions } from './node-project-system';

describe('parseManifestActions', () => {
  it('backsAnActionWithTheConventionalScriptOfTheSameName', () => {
    expect(parseManifestActions({ scripts: { build: 'tsc' } })).toEqual(['build']);
    expect(parseManifestActions({ scripts: { clean: 'rimraf dist' } })).toEqual(['clean']);
    expect(parseManifestActions({ scripts: { test: 'vitest' } })).toEqual(['test']);
  });

  it('declaresTheBackedActionsInAStableOrder', () => {
    // Authoring order in the manifest must not leak into the declared capabilities.
    const manifest: Record<string, unknown> = {
      scripts: { test: 'vitest', clean: 'rimraf dist', build: 'tsc' },
    };
    expect(parseManifestActions(manifest)).toEqual(['build', 'clean', 'test']);
  });

  it('backsNothingFromAScriptThatMerelyLooksBuildShaped', () => {
    // `npm run build` is what the Build button dispatches: declaring the action from `build:prod`
    // would light a button that runs nothing.
    expect(
      parseManifestActions({ scripts: { 'build:prod': 'tsc -p prod', prebuild: 'x' } }),
    ).toEqual([]);
  });

  it('backsNothingWithoutUsableScripts', () => {
    expect(parseManifestActions(null)).toEqual([]);
    expect(parseManifestActions({})).toEqual([]);
    expect(parseManifestActions({ scripts: {} })).toEqual([]);
    expect(parseManifestActions({ scripts: 'build' })).toEqual([]);
    expect(parseManifestActions({ scripts: null })).toEqual([]);
  });
});

describe('NodeProjectSystem', () => {
  const provider: NodeProjectSystem = new NodeProjectSystem();

  it('declaresTheNodeKindWithNoBuildConfigOrTargetAxis', () => {
    expect(provider.kind).toBe('node');
    // The baseline: an interpreted ecosystem, so no build-configuration or target axis, and the
    // actions of a loaded root come from its own manifest rather than from this list.
    expect(provider.capabilities.actions).toEqual([]);
    expect(provider.capabilities.buildConfigurations).toEqual([]);
    expect(provider.capabilities.target).toBeNull();
    expect(provider.capabilities.debug).toEqual({ adapter: 'js-debug' });
  });

  it('ownsPackageManifestsOnly', () => {
    expect(provider.ownsProject('/w/package.json')).toBe(true);
    expect(provider.ownsProject('/w/package-lock.json')).toBe(false);
    expect(provider.ownsProject('/w/tsconfig.json')).toBe(false);
  });
});
