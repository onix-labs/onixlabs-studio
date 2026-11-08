import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseIni, valueLines } from './ini';
import { indexFrom, PipIndex, readPipIndexes } from './pip-config';

describe('parseIni', () => {
  it('parseIni_sectionsContinuationsAndComments_areRead', () => {
    // Arrange
    const text: string = [
      '; a comment',
      '[global]',
      'Index-URL = https://a/simple',
      'extra-index-url =',
      '    https://b/simple',
      '    https://c/simple',
      '# done',
    ].join('\n');

    // Act
    const ini: ReturnType<typeof parseIni> = parseIni(text);

    // Assert
    expect(ini.get('global')?.get('index-url')).toBe('https://a/simple');
    expect(valueLines(ini.get('global')?.get('extra-index-url'))).toEqual([
      'https://b/simple',
      'https://c/simple',
    ]);
  });
});

describe('indexFrom', () => {
  it('indexFrom_pypisSimpleIndex_isPypi_withNoCredential', () => {
    // Act
    const index: PipIndex | null = indexFrom('https://pypi.org/simple');

    // Assert
    expect(index).toEqual({
      name: 'PyPI',
      url: 'https://pypi.org/simple/',
      headers: {},
      isPypi: true,
    });
  });

  it('indexFrom_aPrivateIndexWithACredential_movesItToAHeaderAndOutOfTheName', () => {
    // Act
    const index: PipIndex | null = indexFrom(
      'https://me:s%40cret@pkgs.example.com/repo/pypi/simple/?x=1',
    );

    // Assert
    expect(index?.name).toBe('pkgs.example.com/repo/pypi');
    expect(index?.url).toBe('https://pkgs.example.com/repo/pypi/simple/');
    expect(index?.headers).toEqual({
      Authorization: `Basic ${Buffer.from('me:s@cret').toString('base64')}`,
    });
    expect(JSON.stringify(index)).not.toContain('cret@');
  });

  it('indexFrom_plainHttpToAnotherHost_dropsTheCredential', () => {
    // Act
    const index: PipIndex | null = indexFrom('http://me:secret@pkgs.example.com/simple');

    // Assert
    expect(index?.headers).toEqual({});
    expect(index?.url).toBe('http://pkgs.example.com/simple/');
  });

  it('indexFrom_plainHttpToLoopback_keepsTheCredential', () => {
    // Act
    const index: PipIndex | null = indexFrom('http://me:secret@127.0.0.1:8080/simple');

    // Assert
    expect(index?.headers['Authorization']).toBeDefined();
  });

  it('indexFrom_aCredentialThatIsAnEnvironmentReference_isNotSent', () => {
    // Act
    const index: PipIndex | null = indexFrom('https://${USER}:${TOKEN}@pkgs.example.com/simple');

    // Assert
    expect(index?.headers).toEqual({});
  });

  it.each<[string]>([['file:///srv/wheels'], ['not a url']])(
    'indexFrom_%s_isNotAnIndex',
    (raw: string) => {
      // Act
      const index: PipIndex | null = indexFrom(raw);

      // Assert
      expect(index).toBeNull();
    },
  );
});

describe('readPipIndexes', () => {
  let home: string = '';

  beforeEach(() => {
    home = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-pypi-config-')));
    // ⛔ The user's own pip.conf can hold a private index's password, and has no place in a spec.
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it('readPipIndexes_noConfiguration_isPypiAlone', async () => {
    // Act
    const indexes: readonly PipIndex[] = await readPipIndexes({});

    // Assert
    expect(indexes.map((index: PipIndex): string => index.name)).toEqual(['PyPI']);
  });

  it('readPipIndexes_theUsersPipConf_isRead_installOverGlobal_andTheEnvironmentLast', async () => {
    // Arrange
    const config: string =
      process.platform === 'win32'
        ? path.join(home, 'pip', 'pip.ini')
        : path.join(home, '.pip', 'pip.conf');
    mkdirSync(path.dirname(config), { recursive: true });
    writeFileSync(
      config,
      [
        '[global]',
        'index-url = https://global.example/simple',
        '[install]',
        'index_url = https://install.example/simple',
        'extra-index-url = https://extra.example/simple https://pypi.org/simple',
      ].join('\n'),
    );

    // Act
    const fromFile: readonly PipIndex[] = await readPipIndexes({});
    const fromEnvironment: readonly PipIndex[] = await readPipIndexes({
      PIP_INDEX_URL: 'https://env.example/simple',
    });

    // Assert
    expect(fromFile.map((index: PipIndex): string => index.name)).toEqual([
      'install.example',
      'extra.example',
      'PyPI',
    ]);
    expect(fromEnvironment[0].name).toBe('env.example');
  });

  it('readPipIndexes_pipConfigFile_isAppliedAfterTheUsersFile', async () => {
    // Arrange
    const named: string = path.join(home, 'custom.conf');
    writeFileSync(named, '[global]\nindex-url = https://named.example/simple\n');

    // Act
    const indexes: readonly PipIndex[] = await readPipIndexes({ PIP_CONFIG_FILE: named });

    // Assert
    expect(indexes.map((index: PipIndex): string => index.name)).toEqual(['named.example']);
  });
});
