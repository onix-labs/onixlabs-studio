import { describe, expect, it, vi } from 'vitest';
import type { AiConnection } from '@shared/api/ai-types';
import type { AgentProvider } from './agent-provider';

// The core descriptors construct the real providers, and `ClaudeAgentProvider` reaches Electron through
// its executable resolver. Nothing here cares which binary that finds.
// ⛔ Mocking the relative module is not an option: the Angular unit-test system refuses `vi.mock` on a
// relative import, so the dependency is cut at the bare specifier instead.
vi.mock('electron', () => ({ app: { isPackaged: false } }));

const { AgentProviderRegistry, coreAgentProviders } = await import('./agent-provider-registry');
type AgentProviderDescriptor = import('./agent-provider-registry').AgentProviderDescriptor;

/**
 * Builds a connection with only the fields the registry looks at.
 * @param id The connection identifier.
 * @param auth The authentication kind, which is what the core descriptors match on.
 * @returns Returns the connection.
 */
function connection(id: string, auth: string): AiConnection {
  return { id, auth, models: [], defaultModelId: null } as unknown as AiConnection;
}

/**
 * Builds a descriptor that serves the connections whose auth matches, and reports itself when built.
 * @param id The harness identifier.
 * @param auth The auth kind it serves, or null to serve everything.
 * @param built Collects the ids of harnesses that were asked to build.
 * @returns Returns the descriptor.
 */
function harness(id: string, auth: string | null, built: string[]): AgentProviderDescriptor {
  return {
    id,
    serves: (candidate: AiConnection): boolean => auth === null || candidate.auth === auth,
    create: (): AgentProvider => {
      built.push(id);
      return { id } as unknown as AgentProvider;
    },
  };
}

describe('AgentProviderRegistry', () => {
  it('buildsFromTheFirstHarnessThatServesTheConnection', () => {
    const built: string[] = [];
    const registry: InstanceType<typeof AgentProviderRegistry> = new AgentProviderRegistry();
    registry.register(harness('first', 'demo-login', built));
    registry.register(harness('catch-all', null, built));

    registry.providerFor(connection('c1', 'demo-login'));

    expect(built).toEqual(['first']);
  });

  it('fallsThroughToAHarnessThatServesEverything', () => {
    const built: string[] = [];
    const registry: InstanceType<typeof AgentProviderRegistry> = new AgentProviderRegistry();
    registry.register(harness('first', 'demo-login', built));
    registry.register(harness('catch-all', null, built));

    registry.providerFor(connection('c1', 'api-key'));

    // There is no separate notion of a fallback: a descriptor that serves everything, registered last,
    // is the same rule read from the other end.
    expect(built).toEqual(['catch-all']);
  });

  it('registrationOrderDecidesWhoWinsAContestedConnection', () => {
    const built: string[] = [];
    const registry: InstanceType<typeof AgentProviderRegistry> = new AgentProviderRegistry();
    registry.register(harness('early', 'demo-login', built));
    registry.register(harness('late', 'demo-login', built));

    registry.providerFor(connection('c1', 'demo-login'));

    expect(built).toEqual(['early']);
  });

  it('ignoresASecondHarnessClaimingAnIdAlreadyRegistered', () => {
    const built: string[] = [];
    const registry: InstanceType<typeof AgentProviderRegistry> = new AgentProviderRegistry();
    registry.register(harness('claude', 'demo-login', built));
    registry.register(harness('claude', 'other-login', built));

    expect(registry.registered()).toEqual(['claude']);
    // The impostor is not merely deduplicated in the listing — it never serves anything either.
    expect(registry.providerFor(connection('c1', 'other-login'))).toBeNull();
  });

  it('reportsNoProviderWhenNothingServesTheConnection', () => {
    const registry: InstanceType<typeof AgentProviderRegistry> = new AgentProviderRegistry();
    registry.register(harness('only', 'demo-login', []));

    // Reachable only with no catch-all registered. Building something arbitrary would be worse than
    // leaving the connection listed and unrunnable.
    expect(registry.providerFor(connection('c1', 'api-key'))).toBeNull();
  });

  it('registeredListsTheHarnessesInRegistrationOrder', () => {
    const registry: InstanceType<typeof AgentProviderRegistry> = new AgentProviderRegistry();
    registry.register(harness('a', 'x', []));
    registry.register(harness('b', 'y', []));

    expect(registry.registered()).toEqual(['a', 'b']);
  });
});

describe('coreAgentProviders', () => {
  it('putsTheTwoLiveHarnessesAheadOfTheGenericAdapter', () => {
    // Order is load-bearing: the AI-SDK descriptor serves everything, so anything after it would never
    // be asked.
    expect(coreAgentProviders().map((d: AgentProviderDescriptor): string => d.id)).toEqual([
      'claude',
      'codex',
      'ai-sdk',
    ]);
  });

  it('routesEachAuthKindToTheHarnessThatUsedToBeItsBranch', () => {
    const descriptors: readonly AgentProviderDescriptor[] = coreAgentProviders();

    /**
     * Gets the id of the first core descriptor serving an auth kind.
     * @param auth The auth kind.
     * @returns Returns the harness id, or undefined.
     */
    const servedBy: (auth: string) => string | undefined = (auth: string): string | undefined =>
      descriptors.find((d: AgentProviderDescriptor): boolean => d.serves(connection('c', auth)))
        ?.id;

    // The exact mapping the three-way `if` in AiManager used to make, asserted so the move cannot have
    // changed behaviour.
    expect(servedBy('claude-login')).toBe('claude');
    expect(servedBy('codex-login')).toBe('codex');
    expect(servedBy('api-key')).toBe('ai-sdk');
    // Including a local Ollama, which needs no harness code at all — it is a connection.
    expect(servedBy('none')).toBe('ai-sdk');
  });
});
