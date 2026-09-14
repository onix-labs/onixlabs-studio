import { describe, expect, it, vi } from 'vitest';
import type { AiConnection } from '@shared/api/ai-types';
import type { AgentProvider } from './agent-provider';

// The registry's import graph reaches Electron through the pieces core still keeps — the tool
// descriptions a harness asks for, and the logger. Nothing here cares what any of that resolves to.
// ⛔ Mocking the relative module is not an option: the Angular unit-test system refuses `vi.mock` on a
// relative import, so the dependency is cut at the bare specifier instead.
vi.mock('electron', () => ({ app: { isPackaged: false } }));

const { AgentProviderRegistry, coreAgentProviders, toHarnessDescriptor } =
  await import('./agent-provider-registry');
type AgentProviderDescriptor = import('./agent-provider-registry').AgentProviderDescriptor;

/**
 * Builds a connection with only the fields the registry looks at.
 * @param id The connection identifier.
 * @param auth The authentication kind, which is what the core descriptors match on.
 * @returns Returns the connection.
 */
function connection(id: string, auth: string, harnessId?: string): AiConnection {
  return { id, auth, harnessId, models: [], defaultModelId: null } as unknown as AiConnection;
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
  it('shipsNoProviderAtAll', () => {
    // ⛔ The acceptance test for the whole of #653, and the reason it is asserted rather than assumed:
    // core used to register Claude, Codex and a generic AI-SDK adapter that served *everything*, and
    // adding any one of them back would silently restore working agents to a build that is supposed
    // to have none until the user installs a provider.
    expect(coreAgentProviders()).toEqual([]);
  });

  it('leavesEveryConnectionUnrunnableUntilAHarnessIsInstalled', () => {
    const registry: InstanceType<typeof AgentProviderRegistry> = new AgentProviderRegistry();
    for (const core of coreAgentProviders()) {
      registry.register(core);
    }

    // Each of these used to be served by a built-in — the first two by a vendor harness, the last two
    // by the catch-all adapter. None of them can run now, which is the point.
    expect(registry.providerFor(connection('c1', 'claude-login'))).toBeNull();
    expect(registry.providerFor(connection('c2', 'codex-login'))).toBeNull();
    expect(registry.providerFor(connection('c3', 'api-key'))).toBeNull();
    expect(registry.providerFor(connection('c4', 'none'))).toBeNull();
  });
});

describe('toHarnessDescriptor', () => {
  /**
   * Builds a contributed harness whose payload may or may not be installed.
   * @param installed Whether the payload is on disk.
   * @returns Returns the contributed harness.
   */
  function contributed(installed: boolean): {
    id: string;
    displayName: string;
    priority: number;
    connectionAuths: readonly string[];
    sessionModel: 'stateless';
    remoteControl: boolean;
    spawnSpec: () => { command: string; args: readonly string[] } | null;
  } {
    return {
      id: 'claude-harness',
      displayName: 'Claude',
      priority: 100,
      connectionAuths: ['claude-login'],
      sessionModel: 'stateless',
      remoteControl: false,
      spawnSpec: (): { command: string; args: readonly string[] } | null =>
        installed ? { command: '/bin/harness', args: [] } : null,
    };
  }

  it('servesOnlyAConnectionThatNamesIt', () => {
    const descriptor: AgentProviderDescriptor = toHarnessDescriptor(
      contributed(true),
      () => ({}) as never,
    );

    expect(descriptor.serves(connection('c1', 'claude-login', 'claude-harness'))).toBe(true);
  });

  it('doesNotClaimAConnectionMerelyBecauseItsAuthMatches', () => {
    const descriptor: AgentProviderDescriptor = toHarnessDescriptor(
      contributed(true),
      () => ({}) as never,
    );

    // ⛔ The bug this replaced. Matching on auth meant a plugin took every connection of that kind
    // from the provider Studio ships — a capability downgrade nobody asked for. And `AiAuthKind` is a
    // closed union, so a plugin could not even name a kind of its own: the harness matched nothing at
    // all until a connection could point at it.
    expect(descriptor.serves(connection('c1', 'claude-login'))).toBe(false);
    expect(descriptor.serves(connection('c1', 'api-key'))).toBe(false);
  });

  it('servesNothingWhenItsPayloadIsNotInstalled', () => {
    const descriptor: AgentProviderDescriptor = toHarnessDescriptor(
      contributed(false),
      () => ({}) as never,
    );

    // The manifest can be in the catalogue without the payload being on disk, and a descriptor that
    // claimed a connection it cannot run would take it from the in-core provider that can.
    expect(descriptor.serves(connection('c1', 'claude-login', 'claude-harness'))).toBe(false);
  });

  it('buildsAProviderCarryingTheConnectionsOwnModels', () => {
    const descriptor: AgentProviderDescriptor = toHarnessDescriptor(
      contributed(true),
      () => ({}) as never,
    );

    // The harness knows how to run a turn; the connection knows which models and which id. The
    // registry joins them, which is why the manifest declares neither.
    const provider: AgentProvider = descriptor.create(
      connection('my-claude', 'claude-login', 'claude-harness'),
    );
    expect(provider.id).toBe('my-claude');
    expect(provider.label).toBe('Claude');
  });

  it('isTheOnlyThingRegisteredOnceTheBuiltInsAreGone', () => {
    const registry: InstanceType<typeof AgentProviderRegistry> = new AgentProviderRegistry();
    registry.register(toHarnessDescriptor(contributed(true), () => ({}) as never));
    for (const core of coreAgentProviders()) {
      registry.register(core);
    }

    // "Core defines, plugins provide", finished: contributed harnesses were registered ahead of the
    // in-core ones so a plugin would win a contested connection, and there is nothing left to
    // contest. The ordering stays because it is what made removing each built-in a one-line change.
    expect(registry.registered()).toEqual(['claude-harness']);
  });
});
