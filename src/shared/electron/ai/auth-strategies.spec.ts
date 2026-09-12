import { type AuthContext, type AuthStrategy, strategyFor } from './auth-strategies';

/**
 * Builds an auth context with explicit overrides on the "nothing available" baseline.
 * @param overrides The fields to override.
 * @returns Returns the context.
 */
function context(overrides?: Partial<AuthContext>): AuthContext {
  return {
    storedKey: null,
    ...overrides,
  };
}

describe('strategyFor', () => {
  it('returnsTheStrategyMatchingTheKindsCoreOwns', () => {
    expect(strategyFor('api-key').kind).toBe('api-key');
    expect(strategyFor('none').kind).toBe('none');
  });

  it('anyOtherKind_fallsBackToTheProviderLoginStrategyRatherThanUndefined', () => {
    // 🔥 The auth kind is open now (#653), so anything an installed plugin names arrives here. Indexing
    // straight into the table returned `undefined`, and the first thing anyone would have noticed is
    // `undefined.resolve` part way through a run — the worst possible place to discover it.
    for (const kind of ['claude-login', 'codex-login', 'some-plugins-oauth', '']) {
      expect(strategyFor(kind).kind).toBe('provider-login');
    }
  });
});

describe('provider-login strategy', () => {
  const strategy: AuthStrategy = strategyFor('claude-login');

  it('resolvesAStoredKeyWhenTheUserSetOne', () => {
    // An API key is core's to hold whatever the provider is, so a user who pastes one still gets it
    // used — even for a subscription configuration whose plugin would otherwise sign itself in.
    expect(strategy.resolve(context({ storedKey: 'stored' }))).toEqual({
      source: 'api-key',
      apiKey: 'stored',
    });
  });

  it('resolvesNothingOtherwise_leavingTheLoginToThePlugin', () => {
    // ⛔ Core does not probe `~/.claude` or `~/.codex` any more. Reporting "no credential" is what lets
    // the harness fall through to its own login, which is the only thing that can actually check it.
    expect(strategy.resolve(context())).toEqual({ source: 'none', apiKey: null });
  });

  it('statusIsAvailableWithoutAKey_becauseCoreCannotKnowOtherwise', () => {
    // A false "not signed in" is worse than a vague "ask the plugin": it sends the user to fix a
    // credential that is already working.
    expect(strategy.status(context())).toMatchObject({
      source: 'none',
      available: true,
      hasStoredKey: false,
    });
    expect(strategy.status(context({ storedKey: 'stored' }))).toMatchObject({
      source: 'api-key',
      available: true,
      hasStoredKey: true,
    });
  });

  it('neverSurfacesTheKeyInTheStatus', () => {
    expect(Object.values(strategy.status(context({ storedKey: 'sk-secret' })))).not.toContain(
      'sk-secret',
    );
  });
});

describe('api-key strategy', () => {
  const strategy: AuthStrategy = strategyFor('api-key');

  it('resolvesTheStoredKeyOnly', () => {
    expect(strategy.resolve(context())).toEqual({ source: 'none', apiKey: null });
    expect(strategy.resolve(context({ storedKey: 'stored' }))).toEqual({
      source: 'api-key',
      apiKey: 'stored',
    });
  });

  it('statusReflectsWhetherAKeyIsStored', () => {
    expect(strategy.status(context({ storedKey: 'stored' }))).toMatchObject({
      source: 'api-key',
      available: true,
      hasStoredKey: true,
    });
    expect(strategy.status(context())).toMatchObject({
      source: 'none',
      available: false,
      hasStoredKey: false,
    });
  });
});

describe('none strategy', () => {
  const strategy: AuthStrategy = strategyFor('none');

  it('needsNoCredentialAndIsAlwaysAvailable', () => {
    expect(strategy.resolve(context())).toEqual({ source: 'none', apiKey: null });
    expect(strategy.status(context())).toMatchObject({ source: 'none', available: true });
  });
});
