import { describe, expect, it } from 'vitest';
import { migrateServerId, readServerPaths } from './lsp-settings-migration';

describe('migrateServerId', (): void => {
  it('renamesTheServerIdentifiedByItsLanguage', (): void => {
    expect(migrateServerId('python')).toBe('pyright');
  });

  it('leavesAnUnaffectedIdentifierAlone', (): void => {
    expect(migrateServerId('clangd')).toBe('clangd');
  });
});

describe('readServerPaths', (): void => {
  it('answersAnEmptyMapWhenNothingIsPersisted', (): void => {
    expect(readServerPaths({})).toEqual({});
  });

  it('carriesTheLegacyFieldsOntoTheirServers', (): void => {
    // The override a user set before the map existed has to keep working: silently dropping it would
    // send them back to the copy under Plugins without saying so.
    expect(
      readServerPaths({ clangdPath: '/usr/bin/clangd', typescriptServerPath: '/srv/cli.mjs' }),
    ).toEqual({ clangd: '/usr/bin/clangd', typescript: '/srv/cli.mjs' });
  });

  it('prefersTheMapOverTheLegacyFieldForTheSameServer', (): void => {
    expect(
      readServerPaths({ serverPaths: { clangd: '/opt/clangd' }, clangdPath: '/usr/bin/clangd' }),
    ).toEqual({ clangd: '/opt/clangd' });
  });

  it('keepsAContributedServersOverride', (): void => {
    // The whole point of the map: a server core has never heard of can be overridden too.
    expect(readServerPaths({ serverPaths: { zls: '/usr/local/bin/zls' } })).toEqual({
      zls: '/usr/local/bin/zls',
    });
  });

  it('appliesTheIdentifierRenameToTheMapsKeys', (): void => {
    expect(readServerPaths({ serverPaths: { python: '/usr/bin/pyright' } })).toEqual({
      pyright: '/usr/bin/pyright',
    });
  });

  it('dropsBlankEntriesRatherThanStoringAPathNobodyMeant', (): void => {
    expect(readServerPaths({ serverPaths: { clangd: '   ' }, typescriptServerPath: '  ' })).toEqual(
      {},
    );
  });

  it('refusesMalformedValuesRatherThanRepairingThem', (): void => {
    expect(readServerPaths({ serverPaths: { clangd: 7 } })).toBeNull();
    expect(readServerPaths({ serverPaths: [] })).toBeNull();
    expect(readServerPaths({ clangdPath: 7 })).toBeNull();
  });

  it('treatsAClearedLegacyFieldAsNoOverride', (): void => {
    expect(readServerPaths({ clangdPath: null })).toEqual({});
  });
});
