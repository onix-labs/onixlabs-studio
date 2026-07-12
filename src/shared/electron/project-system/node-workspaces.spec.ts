import { parseWorkspacePatterns, splitWorkspacePattern } from './node-workspaces';

describe('parseWorkspacePatterns', () => {
  it('readsTheArrayForm', () => {
    expect(parseWorkspacePatterns({ workspaces: ['packages/*', 'tools/site'] })).toEqual([
      'packages/*',
      'tools/site',
    ]);
  });

  it('readsTheObjectPackagesForm', () => {
    expect(parseWorkspacePatterns({ workspaces: { packages: ['apps/*'] } })).toEqual(['apps/*']);
  });

  it('dropsNonStringEntries', () => {
    expect(parseWorkspacePatterns({ workspaces: ['packages/*', 7, null] })).toEqual(['packages/*']);
  });

  it('returnsEmptyForMissingOrMalformedDeclarations', () => {
    expect(parseWorkspacePatterns({})).toEqual([]);
    expect(parseWorkspacePatterns(null)).toEqual([]);
    expect(parseWorkspacePatterns({ workspaces: 'packages/*' })).toEqual([]);
    expect(parseWorkspacePatterns({ workspaces: { packages: 'apps/*' } })).toEqual([]);
  });
});

describe('splitWorkspacePattern', () => {
  it('splitsASingleLevelWildcard', () => {
    expect(splitWorkspacePattern('packages/*')).toEqual({ prefix: 'packages', wildcard: true });
    expect(splitWorkspacePattern('packages/*/')).toEqual({ prefix: 'packages', wildcard: true });
  });

  it('acceptsALiteralDirectory', () => {
    expect(splitWorkspacePattern('tools/site')).toEqual({ prefix: 'tools/site', wildcard: false });
  });

  it('rejectsUnsupportedGlobs', () => {
    expect(splitWorkspacePattern('packages/**')).toBeNull();
    expect(splitWorkspacePattern('a/*/b')).toBeNull();
    expect(splitWorkspacePattern('*/lib')).toBeNull();
    expect(splitWorkspacePattern('')).toBeNull();
  });
});
