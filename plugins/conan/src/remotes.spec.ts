import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  basicHeaders,
  ConanCredential,
  conanHome,
  isPublicRemote,
  readCredentials,
  readRemotes,
} from './remotes';

describe('Conan remotes', () => {
  let home: string = '';

  beforeEach(() => {
    home = path.join(
      realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-conan-home-'))),
      '.conan2',
    );
    mkdirSync(home);
  });

  afterEach(() => {
    rmSync(path.dirname(home), { recursive: true, force: true });
  });

  it('conanHome_isDotConan2InHome', () => {
    // Arrange
    const env: Record<string, string> = { HOME: '/users/me' };

    // Act
    const found: string = conanHome(env);

    // Assert
    expect(found).toBe(path.join('/users/me', '.conan2'));
  });

  it('readRemotes_noFile_isConanCenterAlone', async () => {
    // Arrange
    const empty: string = home;

    // Act
    const remotes: readonly { name: string; url: string }[] = await readRemotes(empty);

    // Assert
    expect(remotes).toEqual([{ name: 'conancenter', url: 'https://center2.conan.io' }]);
  });

  it('readRemotes_aFile_keepsEnabledHttpRemotesInOrder', async () => {
    // Arrange
    writeFileSync(
      path.join(home, 'remotes.json'),
      JSON.stringify({
        remotes: [
          {
            name: 'company',
            url: 'https://conan.example.com/artifactory/api/conan/c/',
            verify_ssl: true,
          },
          { name: 'old', url: 'https://old.example.com', disabled: true },
          { name: 'local', url: 'file:///srv/conan' },
          { name: 'conancenter', url: 'https://center2.conan.io' },
        ],
      }),
    );

    // Act
    const remotes: readonly { name: string; url: string }[] = await readRemotes(home);

    // Assert
    expect(remotes).toEqual([
      { name: 'company', url: 'https://conan.example.com/artifactory/api/conan/c' },
      { name: 'conancenter', url: 'https://center2.conan.io' },
    ]);
  });

  it('readCredentials_templatedValues_areNotCredentials', async () => {
    // Arrange
    writeFileSync(
      path.join(home, 'credentials.json'),
      JSON.stringify({
        credentials: [
          { remote: 'company', user: 'me', password: 'secret' },
          { remote: 'other', user: 'me', password: '{{ os.getenv("TOKEN") }}' },
        ],
      }),
    );

    // Act
    const credentials: ReadonlyMap<string, ConanCredential> = await readCredentials(home);

    // Assert
    expect([...credentials]).toEqual([['company', { user: 'me', password: 'secret' }]]);
  });

  it('basicHeaders_aCredential_isBasicAuth', () => {
    // Arrange
    const credential: ConanCredential = { user: 'me', password: 'secret' };

    // Act
    const headers: Record<string, string> = basicHeaders(credential);

    // Assert
    expect(headers).toEqual({
      Authorization: `Basic ${Buffer.from('me:secret').toString('base64')}`,
    });
  });

  it('isPublicRemote_conanCenterOnly', () => {
    // Arrange
    const urls: readonly string[] = [
      'https://center2.conan.io',
      'https://center.conan.io',
      'https://conan.example.com',
      'nonsense',
    ];

    // Act
    const answers: readonly boolean[] = urls.map(isPublicRemote);

    // Assert
    expect(answers).toEqual([true, true, false, false]);
  });
});
