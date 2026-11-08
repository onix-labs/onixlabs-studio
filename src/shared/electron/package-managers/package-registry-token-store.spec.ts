import { describe, expect, it } from 'vitest';
import type { HostingCredentialStorePorts } from '../hosting/hosting-credential-store';
import { normaliseRegistry, PackageRegistryTokenStore } from './package-registry-token-store';

/**
 * Builds a store over an in-memory blob.
 * @returns Returns the store and a view of what it last wrote.
 */
function memoryStore(): { store: PackageRegistryTokenStore; blob: () => string | null } {
  let blob: string | null = null;
  const ports: HostingCredentialStorePorts = {
    load: (): string | null => blob,
    save: (plaintext: string | null): void => {
      blob = plaintext;
    },
  };
  return { store: new PackageRegistryTokenStore(ports), blob: (): string | null => blob };
}

describe('normaliseRegistry', () => {
  it.each([
    ['https://npm.pkg.github.com/', 'https://npm.pkg.github.com'],
    ['  https://feed.example.com/v3/index.json?x=1#y ', 'https://feed.example.com/v3/index.json'],
    ['https://Registry.Example.com/a//', 'https://registry.example.com/a'],
  ])(
    'normaliseRegistry_anHttpsUrl_isOneKeyHoweverWritten %#',
    (input: string, expected: string) => {
      expect(normaliseRegistry(input)).toBe(expected);
    },
  );

  it.each([['http://registry.example.com'], ['https://user:pw@example.com'], ['not a url'], ['']])(
    'normaliseRegistry_anythingElse_isRefused %#',
    (input: string) => {
      expect(normaliseRegistry(input)).toBeNull();
    },
  );
});

describe('PackageRegistryTokenStore', () => {
  it('save_thenToken_handsItOnlyToThePluginAndRegistryItWasSavedFor', () => {
    const { store } = memoryStore();

    expect(store.save('onixlabs.npm', 'https://npm.pkg.github.com/', ' secret ')).toBeNull();

    expect(store.token('onixlabs.npm', 'https://npm.pkg.github.com')).toBe('secret');
    expect(store.token('onixlabs.nuget', 'https://npm.pkg.github.com')).toBeNull();
    expect(store.token('onixlabs.npm', 'https://evil.example')).toBeNull();
  });

  it('save_aRegistryThatIsNotHttps_isRefusedAndNothingIsWritten', () => {
    const { store, blob } = memoryStore();

    const refusal: string | null = store.save('onixlabs.npm', 'http://registry.example', 'x');

    expect(refusal).toContain('https');
    expect(blob()).toBeNull();
  });

  it('list_namesTheRegistries_neverTheTokens', () => {
    const { store } = memoryStore();
    store.save('onixlabs.nuget', 'https://b.example', 'two');
    store.save('onixlabs.npm', 'https://a.example', 'one');

    const listed: string = JSON.stringify(store.list());

    expect(store.list()).toEqual([
      { pluginId: 'onixlabs.npm', registry: 'https://a.example' },
      { pluginId: 'onixlabs.nuget', registry: 'https://b.example' },
    ]);
    expect(listed).not.toContain('one');
    expect(listed).not.toContain('two');
  });

  it('save_aBlankToken_clearsTheEntry', () => {
    const { store, blob } = memoryStore();
    store.save('onixlabs.npm', 'https://a.example', 'one');

    store.save('onixlabs.npm', 'https://a.example/', '   ');

    expect(store.list()).toEqual([]);
    expect(blob()).toBeNull();
  });

  it('clear_forgetsOnlyThatPluginsTokenForThatRegistry', () => {
    const { store } = memoryStore();
    store.save('onixlabs.npm', 'https://a.example', 'one');
    store.save('onixlabs.nuget', 'https://a.example', 'two');

    store.clear('onixlabs.npm', 'https://a.example/');

    expect(store.token('onixlabs.npm', 'https://a.example')).toBeNull();
    expect(store.token('onixlabs.nuget', 'https://a.example')).toBe('two');
  });

  it('list_overACorruptBlob_isEmpty', () => {
    const store: PackageRegistryTokenStore = new PackageRegistryTokenStore({
      load: (): string => '{not json',
      save: (): void => undefined,
    });

    expect(store.list()).toEqual([]);
  });
});
