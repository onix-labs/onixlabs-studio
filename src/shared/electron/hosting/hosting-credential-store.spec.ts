import { beforeEach, describe, expect, it } from 'vitest';
import {
  HostingCredentialStore,
  HostingCredentialStorePorts,
  parseTokenMap,
} from './hosting-credential-store';

/**
 * The host every test operates on.
 */
const HOST: string = 'github.com';

/**
 * An in-memory stand-in for the encrypted blob.
 */
class FakePorts implements HostingCredentialStorePorts {
  /**
   * Holds the stored blob, or null when none is.
   */
  public blob: string | null = null;

  /**
   * Reads the blob.
   * @returns Returns it.
   */
  public load(): string | null {
    return this.blob;
  }

  /**
   * Writes the blob.
   * @param plaintext The blob, or null to clear it.
   */
  public save(plaintext: string | null): void {
    this.blob = plaintext;
  }
}

describe('parseTokenMap', () => {
  it('readsAStoredMap', () => {
    expect(parseTokenMap('{"github.com":"abc"}')).toEqual({ 'github.com': 'abc' });
  });

  it('treatsAnAbsentOrEmptyBlobAsNoTokens', () => {
    expect(parseTokenMap(null)).toEqual({});
    expect(parseTokenMap('')).toEqual({});
  });

  it('treatsACorruptBlobAsNoTokens_ratherThanThrowing', () => {
    // A credential file written under a different OS key decrypts to nonsense. That must leave the
    // user signed out and able to paste a new token, not unable to open settings at all.
    expect(parseTokenMap('not json')).toEqual({});
    expect(parseTokenMap('["an","array"]')).toEqual({});
    expect(parseTokenMap('{"github.com":42}')).toEqual({});
  });
});

describe('HostingCredentialStore', () => {
  let ports: FakePorts;
  let store: HostingCredentialStore;

  beforeEach(() => {
    ports = new FakePorts();
    store = new HostingCredentialStore(ports);
  });

  it('holdsNothing_untilATokenIsStored', () => {
    expect(store.token(HOST)).toBeNull();
    expect(store.hasStoredToken(HOST)).toBe(false);
  });

  it('storesAndReadsAToken', () => {
    store.setToken(HOST, 'ghp_stored');

    expect(store.token(HOST)).toBe('ghp_stored');
    expect(store.hasStoredToken(HOST)).toBe(true);
  });

  it('trimsAStoredToken', () => {
    // A pasted token routinely carries a trailing newline; sending that in a header would fail the
    // request for a reason the user could not possibly diagnose.
    store.setToken(HOST, '  ghp_stored\n');

    expect(store.token(HOST)).toBe('ghp_stored');
  });

  it('storingABlankToken_clearsInstead_soEmptyingTheFieldSignsOut', () => {
    store.setToken(HOST, 'ghp_stored');

    store.setToken(HOST, '   ');

    expect(store.hasStoredToken(HOST)).toBe(false);
    expect(store.token(HOST)).toBeNull();
  });

  it('clearingTheLastToken_removesTheBlobEntirely', () => {
    // Signing out should leave no credential file behind, rather than an encrypted empty object.
    store.setToken(HOST, 'ghp_stored');
    expect(ports.blob).not.toBeNull();

    store.clearToken(HOST);

    expect(ports.blob).toBeNull();
  });

  it('keepsTokensForOtherHosts_whenOneIsCleared', () => {
    store.setToken(HOST, 'ghp_public');
    store.setToken('github.example.com', 'ghp_enterprise');

    store.clearToken(HOST);

    expect(store.hasStoredToken(HOST)).toBe(false);
    expect(store.token('github.example.com')).toBe('ghp_enterprise');
  });

  it('clearingAnAbsentToken_isANoOp', () => {
    expect((): void => store.clearToken(HOST)).not.toThrow();
    expect(ports.blob).toBeNull();
  });
});
