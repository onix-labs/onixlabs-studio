import { type AuthContext, type AuthStrategy, strategyFor } from './auth-strategies';

/**
 * Builds an auth context with explicit overrides on the "nothing available" baseline.
 * @param overrides The fields to override.
 * @returns Returns the context.
 */
function context(overrides?: Partial<AuthContext>): AuthContext {
  return { storedKey: null, hasLocalLogin: false, envKey: null, ...overrides };
}

describe('strategyFor', () => {
  it('returnsTheStrategyMatchingTheKind', () => {
    expect(strategyFor('api-key').kind).toBe('api-key');
    expect(strategyFor('none').kind).toBe('none');
    expect(strategyFor('claude-login').kind).toBe('claude-login');
  });
});

describe('claude-login strategy', () => {
  const strategy: AuthStrategy = strategyFor('claude-login');

  it('resolvesLocalLoginFirst', () => {
    expect(strategy.resolve(context({ hasLocalLogin: true, storedKey: 'k', envKey: 'e' }))).toEqual(
      {
        source: 'local-login',
        apiKey: null,
      },
    );
  });

  it('fallsBackToStoredThenEnvThenNone', () => {
    expect(strategy.resolve(context({ storedKey: 'stored', envKey: 'env' }))).toEqual({
      source: 'api-key',
      apiKey: 'stored',
    });
    expect(strategy.resolve(context({ envKey: 'env' }))).toEqual({
      source: 'api-key',
      apiKey: 'env',
    });
    expect(strategy.resolve(context())).toEqual({ source: 'none', apiKey: null });
  });

  it('statusReportsTheActiveSourceAndStoredFlag', () => {
    expect(strategy.status(context({ hasLocalLogin: true, storedKey: 'k' }))).toMatchObject({
      source: 'local-login',
      available: true,
      hasStoredKey: true,
    });
    expect(strategy.status(context({ envKey: 'env' }))).toMatchObject({
      source: 'api-key',
      available: true,
      hasStoredKey: false,
    });
    expect(strategy.status(context())).toMatchObject({ source: 'none', available: false });
  });
});

describe('api-key strategy', () => {
  const strategy: AuthStrategy = strategyFor('api-key');

  it('resolvesTheStoredKeyOnly_ignoringLocalLoginAndEnv', () => {
    expect(strategy.resolve(context({ hasLocalLogin: true, envKey: 'env' }))).toEqual({
      source: 'none',
      apiKey: null,
    });
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
