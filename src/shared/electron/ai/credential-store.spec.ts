import { ANTHROPIC_KEY_CONNECTION_ID } from '@shared/api/ai-types';
import type { AiAuthStatus } from '@shared/api/ai-types';
import {
  CredentialStore,
  type CredentialStorePorts,
  parseCredentialMap,
  removeKeyFrom,
  serializeCredentialMap,
  setKeyIn,
} from './credential-store';

/**
 * A credential store backed by an in-memory blob, with a reader for the current blob.
 */
interface FakeStore {
  store: CredentialStore;
  blob: () => string | null;
}

/**
 * Builds a credential store backed by an in-memory blob (standing in for the encrypted-at-rest file),
 * so the store's logic is exercised without OS secure storage.
 * @param options The initial blob and environment fakes.
 * @returns Returns the store and a reader for the current blob.
 */
function fakeStore(options?: {
  initialBlob?: string | null;
  hasLocalLogin?: boolean;
  envKey?: string | null;
}): FakeStore {
  let blob: string | null = options?.initialBlob ?? null;
  const ports: CredentialStorePorts = {
    load: (): string | null => blob,
    save: (plaintext: string | null): void => {
      blob = plaintext;
    },
    hasLocalLogin: (): boolean => options?.hasLocalLogin ?? false,
    envKey: (): string | null => options?.envKey ?? null,
  };
  return { store: new CredentialStore(ports), blob: (): string | null => blob };
}

describe('parseCredentialMap', () => {
  it('emptyOrAbsentBlob_yieldsEmptyMap', () => {
    expect(parseCredentialMap(null)).toEqual({});
    expect(parseCredentialMap('')).toEqual({});
  });

  it('jsonObject_isUsedDirectly', () => {
    expect(parseCredentialMap('{"openai":"sk-a","xai":"sk-b"}')).toEqual({
      openai: 'sk-a',
      xai: 'sk-b',
    });
  });

  it('legacyRawKey_migratesOntoTheAnthropicKeyConnection', () => {
    expect(parseCredentialMap('sk-ant-legacy')).toEqual({
      [ANTHROPIC_KEY_CONNECTION_ID]: 'sk-ant-legacy',
    });
  });

  it('roundTripsThroughSerialize', () => {
    const map: Record<string, string> = { a: '1', b: '2' };
    expect(parseCredentialMap(serializeCredentialMap(map))).toEqual(map);
  });
});

describe('setKeyIn / removeKeyFrom', () => {
  it('areImmutable', () => {
    const original: Record<string, string> = { a: '1' };
    expect(setKeyIn(original, 'b', '2')).toEqual({ a: '1', b: '2' });
    expect(removeKeyFrom({ a: '1', b: '2' }, 'a')).toEqual({ b: '2' });
    expect(original).toEqual({ a: '1' });
  });
});

describe('CredentialStore keys', () => {
  it('storesAndReadsKeysPerConnectionIndependently', () => {
    const { store } = fakeStore();

    store.setKey('openai', 'sk-openai');
    store.setKey('xai', 'sk-xai');

    expect(store.storedKeyFor('openai')).toBe('sk-openai');
    expect(store.storedKeyFor('xai')).toBe('sk-xai');
    expect(store.storedKeyFor('deepseek')).toBeNull();
  });

  it('clearingOneConnection_leavesTheOthers', () => {
    const { store } = fakeStore();
    store.setKey('openai', 'sk-openai');
    store.setKey('xai', 'sk-xai');

    store.clearKey('openai');

    expect(store.storedKeyFor('openai')).toBeNull();
    expect(store.storedKeyFor('xai')).toBe('sk-xai');
  });

  it('setKey_trimsAndBlankClears', () => {
    const { store } = fakeStore();
    store.setKey('openai', '  sk-openai  ');
    expect(store.storedKeyFor('openai')).toBe('sk-openai');

    store.setKey('openai', '   ');
    expect(store.storedKeyFor('openai')).toBeNull();
  });

  it('clearingTheLastKey_emptiesTheBlob', () => {
    const { store, blob } = fakeStore();
    store.setKey('openai', 'sk-openai');
    expect(blob()).not.toBeNull();

    store.clearKey('openai');

    expect(blob()).toBeNull();
  });

  it('migratesALegacyRawKeyBlobOntoTheAnthropicKeyConnection', () => {
    const { store } = fakeStore({ initialBlob: 'sk-ant-legacy' });

    // A pre-connections app stored a single raw Anthropic key; it migrates onto the built-in Anthropic
    // API-key connection so it keeps authenticating that connection after the upgrade.
    expect(store.storedKeyFor(ANTHROPIC_KEY_CONNECTION_ID)).toBe('sk-ant-legacy');
    expect(store.resolveCredentialFor(ANTHROPIC_KEY_CONNECTION_ID, 'api-key')).toEqual({
      source: 'api-key',
      apiKey: 'sk-ant-legacy',
    });
  });
});

describe('CredentialStore resolution', () => {
  it('apiKey_resolvesFromTheStoredKeyOnly', () => {
    const { store } = fakeStore({ hasLocalLogin: true, envKey: 'sk-env' });
    store.setKey('openai', 'sk-openai');

    expect(store.resolveCredentialFor('openai', 'api-key')).toEqual({
      source: 'api-key',
      apiKey: 'sk-openai',
    });
    expect(store.resolveCredentialFor('deepseek', 'api-key')).toEqual({
      source: 'none',
      apiKey: null,
    });
  });

  it('claudeLogin_prefersLocalLoginThenStoredThenEnv', () => {
    expect(
      fakeStore({ hasLocalLogin: true }).store.resolveCredentialFor('claude', 'claude-login'),
    ).toEqual({ source: 'local-login', apiKey: null });

    const stored: FakeStore = fakeStore({ envKey: 'sk-env' });
    stored.store.setKey('claude', 'sk-stored');
    expect(stored.store.resolveCredentialFor('claude', 'claude-login')).toEqual({
      source: 'api-key',
      apiKey: 'sk-stored',
    });

    expect(
      fakeStore({ envKey: 'sk-env' }).store.resolveCredentialFor('claude', 'claude-login'),
    ).toEqual({ source: 'api-key', apiKey: 'sk-env' });

    expect(fakeStore().store.resolveCredentialFor('claude', 'claude-login')).toEqual({
      source: 'none',
      apiKey: null,
    });
  });

  it('none_alwaysResolvesToNoCredential', () => {
    expect(fakeStore().store.resolveCredentialFor('ollama', 'none')).toEqual({
      source: 'none',
      apiKey: null,
    });
  });

  it('authFor_carriesLocalLoginAndTheResolvedKey', () => {
    const { store } = fakeStore({ hasLocalLogin: true });
    store.setKey('openai', 'sk-openai');

    expect(store.authFor('openai', 'api-key')).toEqual({
      hasLocalLogin: true,
      apiKey: 'sk-openai',
    });
  });
});

describe('CredentialStore status', () => {
  it('apiKeyStatus_reflectsWhetherAKeyIsStored_neverCarriesTheKey', () => {
    const { store } = fakeStore();
    store.setKey('openai', 'sk-openai');

    const withKey: AiAuthStatus = store.statusFor('openai', 'api-key');
    expect(withKey.available).toBe(true);
    expect(withKey.hasStoredKey).toBe(true);
    expect(Object.values(withKey)).not.toContain('sk-openai');

    const withoutKey: AiAuthStatus = store.statusFor('deepseek', 'api-key');
    expect(withoutKey.available).toBe(false);
    expect(withoutKey.source).toBe('none');
  });

  it('noneStatus_isAlwaysAvailable', () => {
    expect(fakeStore().store.statusFor('ollama', 'none').available).toBe(true);
  });
});
