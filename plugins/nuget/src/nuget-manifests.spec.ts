import {
  NuGetReference,
  parseAssetsInstalled,
  parseLockInstalled,
  parsePackageReferences,
  parsePackageVersions,
  parsePackagesConfig,
} from './nuget-manifests';
import { compareReleaseVersions } from './versions';

describe('parsePackageReferences', () => {
  it('reads the attribute form', () => {
    const xml: string = `<Project><ItemGroup>
      <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    </ItemGroup></Project>`;
    expect(parsePackageReferences(xml)).toEqual<NuGetReference[]>([
      { id: 'Newtonsoft.Json', version: '13.0.3', scope: 'production' },
    ]);
  });

  it('reads the child-element form', () => {
    const xml: string = `<PackageReference Include="Serilog"><Version>3.1.1</Version></PackageReference>`;
    expect(parsePackageReferences(xml)).toEqual<NuGetReference[]>([
      { id: 'Serilog', version: '3.1.1', scope: 'production' },
    ]);
  });

  it('prefers VersionOverride and marks PrivateAssets=all as development', () => {
    const xml: string = `
      <PackageReference Include="A" Version="1.0.0" VersionOverride="1.2.0" />
      <PackageReference Include="StyleCop.Analyzers" Version="1.1.118" PrivateAssets="all" />`;
    expect(parsePackageReferences(xml)).toEqual<NuGetReference[]>([
      { id: 'A', version: '1.2.0', scope: 'production' },
      { id: 'StyleCop.Analyzers', version: '1.1.118', scope: 'development' },
    ]);
  });

  it('emits a null version when the project defers to central management', () => {
    const xml: string = `<PackageReference Include="Central.Managed" />`;
    expect(parsePackageReferences(xml)).toEqual<NuGetReference[]>([
      { id: 'Central.Managed', version: null, scope: 'production' },
    ]);
  });
});

describe('parsePackageVersions', () => {
  it('reads central versions keyed by lower-cased id', () => {
    const xml: string = `<Project><ItemGroup>
      <PackageVersion Include="Central.Managed" Version="4.5.6" />
    </ItemGroup></Project>`;
    const versions: ReadonlyMap<string, string> = parsePackageVersions(xml);
    expect(versions.get('central.managed')).toBe('4.5.6');
  });
});

describe('parsePackagesConfig', () => {
  it('reads legacy entries and the development flag', () => {
    const xml: string = `<packages>
      <package id="EntityFramework" version="6.4.4" targetFramework="net48" />
      <package id="StyleCop" version="1.0.0" developmentDependency="true" />
    </packages>`;
    expect(parsePackagesConfig(xml)).toEqual<NuGetReference[]>([
      { id: 'EntityFramework', version: '6.4.4', scope: 'production' },
      { id: 'StyleCop', version: '1.0.0', scope: 'development' },
    ]);
  });
});

describe('parseLockInstalled', () => {
  it('reads resolved versions across frameworks, keeping the highest', () => {
    const lock: unknown = {
      dependencies: {
        'net8.0': { 'Newtonsoft.Json': { type: 'Direct', resolved: '13.0.1' } },
        'net9.0': { 'Newtonsoft.Json': { type: 'Direct', resolved: '13.0.3' } },
      },
    };
    const versions: ReadonlyMap<string, string> = parseLockInstalled(lock, compareReleaseVersions);
    expect(versions.get('newtonsoft.json')).toBe('13.0.3');
  });
});

describe('parseAssetsInstalled', () => {
  it('reads resolved versions from library keys of package type', () => {
    const assets: unknown = {
      libraries: {
        'Serilog/3.1.1': { type: 'package' },
        'MyProject/1.0.0': { type: 'project' },
      },
    };
    const versions: ReadonlyMap<string, string> = parseAssetsInstalled(
      assets,
      compareReleaseVersions,
    );
    expect(versions.get('serilog')).toBe('3.1.1');
    expect(versions.has('myproject')).toBe(false);
  });
});
