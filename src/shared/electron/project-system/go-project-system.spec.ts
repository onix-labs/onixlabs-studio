import { GoProjectSystem, parseGoModulePath } from './go-project-system';

describe('parseGoModulePath', () => {
  it('readsTheModuleDirective', () => {
    expect(parseGoModulePath('module github.com/acme/widget\n\ngo 1.22')).toBe(
      'github.com/acme/widget',
    );
  });

  it('returnsNullWhenAbsent', () => {
    expect(parseGoModulePath(null)).toBeNull();
    expect(parseGoModulePath('go 1.22\nrequire ()')).toBeNull();
  });
});

describe('GoProjectSystem', () => {
  const provider: GoProjectSystem = new GoProjectSystem();

  it('declaresTheGoKindWithAGoosGoarchAxisAndNoBuildConfigs', () => {
    expect(provider.kind).toBe('go');
    expect(provider.capabilities.actions).toEqual(['build', 'clean', 'rebuild']);
    // Go has a target (GOOS/GOARCH) axis but no Debug/Release build-configuration axis.
    expect(provider.capabilities.buildConfigurations).toEqual([]);
    expect(provider.capabilities.target?.kind).toBe('arch');
    expect(provider.capabilities.debug).toBeNull();
  });

  it('ownsGoModManifestsOnly', () => {
    expect(provider.ownsProject('/w/go.mod')).toBe(true);
    expect(provider.ownsProject('/w/go.sum')).toBe(false);
    expect(provider.ownsProject('/w/main.go')).toBe(false);
  });
});
