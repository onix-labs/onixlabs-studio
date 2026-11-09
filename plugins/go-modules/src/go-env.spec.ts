import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GoEnvironment,
  goEnvironmentFrom,
  matchesPatterns,
  parseGoEnvFile,
  parseGoProxy,
  readGoEnvironment,
  userConfigDir,
} from './go-env';

describe('parseGoProxy', () => {
  it('parseGoProxy_default_isTheProxyThenDirect', () => {
    expect(parseGoProxy('https://proxy.golang.org,direct')).toEqual([
      { kind: 'proxy', url: 'https://proxy.golang.org', fallBackOnAnyError: false },
      { kind: 'direct' },
    ]);
  });

  it('parseGoProxy_pipeAndSchemelessEntries_fallBackOnAnyErrorAndAreHttps', () => {
    expect(parseGoProxy('corp.example/go/|https://proxy.golang.org')).toEqual([
      { kind: 'proxy', url: 'https://corp.example/go', fallBackOnAnyError: true },
      { kind: 'proxy', url: 'https://proxy.golang.org', fallBackOnAnyError: false },
    ]);
  });

  it('parseGoProxy_offOrDirect_endsTheList', () => {
    expect(parseGoProxy('off,https://proxy.golang.org')).toEqual([{ kind: 'off' }]);
    expect(parseGoProxy('direct')).toEqual([{ kind: 'direct' }]);
  });
});

describe('parseGoEnvFile', () => {
  it('parseGoEnvFile_keyValueLines_areRead', () => {
    expect(
      parseGoEnvFile('GOPROXY=https://a.example\n# note\n\nGOPRIVATE= corp.example \nbad\n'),
    ).toEqual({
      GOPROXY: 'https://a.example',
      GOPRIVATE: 'corp.example',
    });
  });
});

describe('goEnvironmentFrom', () => {
  it('goEnvironmentFrom_nothingSet_isTheDefaultsWithNetrc', () => {
    // Arrange, Act
    const environment: GoEnvironment = goEnvironmentFrom({}, { HOME: '/home/u' });

    // Assert
    expect(environment.proxies[0]).toMatchObject({ url: 'https://proxy.golang.org' });
    expect(environment.noProxy).toEqual([]);
    expect(environment.noSumDb).toEqual([]);
    expect(environment.netrc).toBe(true);
  });

  it('goEnvironmentFrom_goprivate_isTheDefaultForBothNoProxyAndNoSumDb', () => {
    // Arrange, Act
    const environment: GoEnvironment = goEnvironmentFrom(
      { GOPRIVATE: 'corp.example/,*.internal', GONOSUMDB: 'other.example' },
      {},
    );

    // Assert
    expect(environment.noProxy).toEqual(['corp.example', '*.internal']);
    expect(environment.noSumDb).toEqual(['other.example']);
  });

  it('goEnvironmentFrom_goauthOff_turnsNetrcOff', () => {
    expect(goEnvironmentFrom({ GOAUTH: 'off' }, {}).netrc).toBe(false);
    expect(goEnvironmentFrom({ GOAUTH: 'git /x;netrc' }, {}).netrc).toBe(true);
  });
});

describe('matchesPatterns', () => {
  it('matchesPatterns_prefixOfWholeElements_matches', () => {
    expect(matchesPatterns('corp.example/team/lib', ['corp.example'])).toBe(true);
    expect(matchesPatterns('corp.example/team/lib', ['corp.example/team'])).toBe(true);
    expect(matchesPatterns('corp.example.evil/lib', ['corp.example'])).toBe(false);
    expect(matchesPatterns('corp.example/teamwork', ['corp.example/team'])).toBe(false);
  });

  it('matchesPatterns_globs_matchWithinOneElement', () => {
    expect(matchesPatterns('git.internal/x', ['*.internal'])).toBe(true);
    expect(matchesPatterns('a.b.internal/x', ['*.internal'])).toBe(true);
    expect(matchesPatterns('github.com/corp-1/x', ['github.com/corp-?'])).toBe(true);
    expect(matchesPatterns('github.com/corpA/x', ['github.com/corp[0-9]'])).toBe(false);
    expect(matchesPatterns('github.com/x', ['github.com/['])).toBe(false);
  });

  it('matchesPatterns_patternLongerThanThePath_doesNotMatch', () => {
    expect(matchesPatterns('corp.example', ['corp.example/team'])).toBe(false);
  });
});

describe('userConfigDir', () => {
  it('userConfigDir_eachPlatform_isWhereGoLooks', () => {
    expect(userConfigDir({ HOME: '/u' }, 'darwin')).toBe(
      path.join('/u', 'Library', 'Application Support'),
    );
    expect(userConfigDir({ HOME: '/u' }, 'linux')).toBe(path.join('/u', '.config'));
    expect(userConfigDir({ HOME: '/u', XDG_CONFIG_HOME: '/x' }, 'linux')).toBe('/x');
    expect(userConfigDir({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'win32')).toBe(
      'C:\\Users\\u\\AppData\\Roaming',
    );
  });
});

describe('readGoEnvironment', () => {
  let home: string = '';

  beforeEach(() => {
    home = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-go-env-')));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('readGoEnvironment_envFileAndEnvironment_environmentWins', async () => {
    // Arrange
    const file: string = path.join(home, 'goenv');
    writeFileSync(file, 'GOPROXY=https://file.example\nGOPRIVATE=corp.example\n');

    // Act
    const environment: GoEnvironment = await readGoEnvironment({
      HOME: home,
      GOENV: file,
      GOPROXY: 'https://env.example',
    });

    // Assert
    expect(environment.proxies[0]).toMatchObject({ url: 'https://env.example' });
    expect(environment.noProxy).toEqual(['corp.example']);
  });

  it('readGoEnvironment_defaultFileLocation_isRead', async () => {
    // Arrange
    const directory: string = path.join(
      userConfigDir({ HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') }),
      'go',
    );
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'env'), 'GOPROXY=off\n');

    // Act
    const environment: GoEnvironment = await readGoEnvironment({
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      APPDATA: path.join(home, '.config'),
    });

    // Assert
    expect(environment.proxies).toEqual([{ kind: 'off' }]);
  });

  it('readGoEnvironment_goenvOff_readsNoFile', async () => {
    // Arrange
    const file: string = path.join(home, 'goenv');
    writeFileSync(file, 'GOPROXY=off\n');

    // Act
    const environment: GoEnvironment = await readGoEnvironment({ HOME: home, GOENV: 'off' });

    // Assert
    expect(environment.proxies[0]).toMatchObject({ kind: 'proxy' });
  });
});
