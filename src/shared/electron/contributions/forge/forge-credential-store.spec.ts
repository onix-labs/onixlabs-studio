import {
  ForgeCredentialStore,
  ForgeCredentialStorePorts,
  parseTokenMap,
  ResolvedToken,
} from './forge-credential-store';

/**
 * The host every test operates on.
 */
const HOST: string = 'github.com';

/**
 * An in-memory stand-in for the encrypted blob and the `gh` CLI probe.
 */
class FakePorts implements ForgeCredentialStorePorts {
  /**
   * Holds the stored blob, or null when none is.
   */
  public blob: string | null = null;

  /**
   * Holds the token the CLI reports, or null when it reports none.
   */
  public cli: string | null = null;

  /**
   * Holds the hosts the CLI was asked about, so the probe can be shown to be skipped.
   */
  public readonly cliCalls: string[] = [];

  public load(): string | null {
    return this.blob;
  }

  public save(plaintext: string | null): void {
    this.blob = plaintext;
  }

  public ghToken(host: string): string | null {
    this.cliCalls.push(host);
    return this.cli;
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

describe('ForgeCredentialStore', () => {
  let ports: FakePorts;
  let store: ForgeCredentialStore;

  beforeEach(() => {
    ports = new FakePorts();
    store = new ForgeCredentialStore(ports);
  });

  it('resolvesNothing_whenNoTokenIsStoredAndTheCliHasNone', () => {
    const resolved: ResolvedToken = store.resolve(HOST);

    expect(resolved).toEqual({ token: null, source: 'none' });
    expect(store.hasStoredToken(HOST)).toBe(false);
  });

  it('storesAndResolvesAToken', () => {
    store.setToken(HOST, 'ghp_stored');

    expect(store.resolve(HOST)).toEqual({ token: 'ghp_stored', source: 'stored' });
    expect(store.hasStoredToken(HOST)).toBe(true);
  });

  it('trimsAStoredToken', () => {
    // A pasted token routinely carries a trailing newline; sending that in a header would fail the
    // request for a reason the user could not possibly diagnose.
    store.setToken(HOST, '  ghp_stored\n');

    expect(store.resolve(HOST).token).toBe('ghp_stored');
  });

  it('prefersTheStoredToken_overTheCliToken', () => {
    // Pasting a token into Studio is an explicit act and must win over an ambient login.
    ports.cli = 'ghp_cli';
    store.setToken(HOST, 'ghp_stored');

    expect(store.resolve(HOST)).toEqual({ token: 'ghp_stored', source: 'stored' });
    expect(ports.cliCalls).toEqual([]);
  });

  it('fallsBackToTheCliToken_whenNothingIsStored', () => {
    ports.cli = 'ghp_cli';

    expect(store.resolve(HOST)).toEqual({ token: 'ghp_cli', source: 'gh-cli' });
    expect(ports.cliCalls).toEqual([HOST]);
  });

  it('clearingTheStoredToken_fallsBackToTheCliRatherThanSigningOut', () => {
    ports.cli = 'ghp_cli';
    store.setToken(HOST, 'ghp_stored');

    store.clearToken(HOST);

    expect(store.hasStoredToken(HOST)).toBe(false);
    expect(store.resolve(HOST)).toEqual({ token: 'ghp_cli', source: 'gh-cli' });
  });

  it('storingABlankToken_clearsInstead_soEmptyingTheFieldSignsOut', () => {
    store.setToken(HOST, 'ghp_stored');

    store.setToken(HOST, '   ');

    expect(store.hasStoredToken(HOST)).toBe(false);
    expect(store.resolve(HOST)).toEqual({ token: null, source: 'none' });
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
    expect(store.hasStoredToken('github.example.com')).toBe(true);
  });

  it('clearingAnAbsentToken_isANoOp', () => {
    expect((): void => store.clearToken(HOST)).not.toThrow();
    expect(ports.blob).toBeNull();
  });

  it('reportsAStoredToken_evenWhenItWouldBeRejected', () => {
    // hasStoredToken is what the settings page's Clear action acts on, so it describes the file, not
    // whether the forge likes what is in it.
    store.setToken(HOST, 'ghp_expired');

    expect(store.hasStoredToken(HOST)).toBe(true);
  });
});
