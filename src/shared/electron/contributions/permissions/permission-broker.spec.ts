import { describe, expect, it, Mock, vi } from 'vitest';
import { DefaultGrantPolicy, GrantPolicy } from './grant-policy';
import { PermissionBroker, PermissionFactory, PermissionRequest } from './permission-broker';
import {
  ContributionOrigin,
  GrantDecision,
  PermissionDeniedError,
  PermissionId,
} from './permission';
import { ContainerSocket, ContainerSocketFactory } from './brokers/container-socket';

/**
 * A sentinel handle a fake factory mints, so a test can assert the broker returned exactly what the
 * factory created.
 */
const HANDLE: { readonly kind: string } = { kind: 'handle' };

/**
 * Builds a factory map with a single fake factory for `container.socket` minting {@link HANDLE}, plus a
 * spy on its `create` so a test can assert it was (or was not) called.
 */
function fakeFactories(): {
  factories: ReadonlyMap<PermissionId, PermissionFactory>;
  create: Mock;
} {
  const create: Mock = vi.fn((): { readonly kind: string } => HANDLE);
  const factory: PermissionFactory = { id: 'container.socket', create };
  return {
    factories: new Map<PermissionId, PermissionFactory>([['container.socket', factory]]),
    create,
  };
}

/**
 * A policy that always returns the given decision, for isolating the broker's grant/deny paths.
 */
function fixedPolicy(decision: GrantDecision): GrantPolicy {
  return { decide: (): GrantDecision => decision };
}

/**
 * Builds a permission request for a first-party contribution declaring the given permissions.
 */
function request(
  declared: PermissionId[],
  origin: ContributionOrigin = 'first-party',
): PermissionRequest {
  return { contributionId: 'docker', origin, declared: new Set<PermissionId>(declared) };
}

describe('PermissionBroker', () => {
  it('resolvesADeclaredGrantedPermissionToItsHandleAndAuditsAllow', () => {
    const { factories, create } = fakeFactories();
    const audit: Mock = vi.fn();
    const broker: PermissionBroker = new PermissionBroker(factories, fixedPolicy('allow'), audit);

    const handle: unknown = broker.resolve(request(['container.socket']), 'container.socket');

    expect(handle).toBe(HANDLE);
    expect(create).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith({
      contributionId: 'docker',
      permission: 'container.socket',
      decision: 'allow',
      source: 'policy',
    });
  });

  it('throwsAndAuditsUndeclaredWhenThePermissionWasNeverDeclared_withoutMintingAHandle', () => {
    const { factories, create } = fakeFactories();
    const audit: Mock = vi.fn();
    const broker: PermissionBroker = new PermissionBroker(factories, fixedPolicy('allow'), audit);

    expect(() => broker.resolve(request([]), 'container.socket')).toThrow(PermissionDeniedError);
    expect(create).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith({
      contributionId: 'docker',
      permission: 'container.socket',
      decision: 'deny',
      source: 'undeclared',
    });
  });

  it('throwsAndAuditsDeniedWhenThePolicyRefusesADeclaredPermission', () => {
    const { factories, create } = fakeFactories();
    const audit: Mock = vi.fn();
    const broker: PermissionBroker = new PermissionBroker(factories, fixedPolicy('deny'), audit);

    let thrown: PermissionDeniedError | null = null;
    try {
      broker.resolve(request(['container.socket']), 'container.socket');
    } catch (error: unknown) {
      thrown = error as PermissionDeniedError;
    }

    expect(thrown).toBeInstanceOf(PermissionDeniedError);
    expect(thrown?.reason).toBe('denied');
    expect(create).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith({
      contributionId: 'docker',
      permission: 'container.socket',
      decision: 'deny',
      source: 'policy',
    });
  });

  it('throwsWhenGrantedButNoFactoryIsRegistered', () => {
    const audit: Mock = vi.fn();
    const broker: PermissionBroker = new PermissionBroker(
      new Map<PermissionId, PermissionFactory>(),
      fixedPolicy('allow'),
      audit,
    );

    expect(() => broker.resolve(request(['container.socket']), 'container.socket')).toThrow(
      PermissionDeniedError,
    );
    expect(audit).toHaveBeenCalledWith({
      contributionId: 'docker',
      permission: 'container.socket',
      decision: 'deny',
      source: 'policy',
    });
  });

  it('endToEnd_grantsAFirstPartyContainerSocketAndDeniesThirdParty', () => {
    const audit: Mock = vi.fn();
    const broker: PermissionBroker = new PermissionBroker(
      new Map<PermissionId, PermissionFactory>([
        ['container.socket', new ContainerSocketFactory((): string => '/tmp/docker.sock')],
      ]),
      new DefaultGrantPolicy(),
      audit,
    );

    const socket: ContainerSocket = broker.resolve<ContainerSocket>(
      request(['container.socket']),
      'container.socket',
    );
    expect(socket.path).toBe('/tmp/docker.sock');

    expect(() =>
      broker.resolve(request(['container.socket'], 'third-party'), 'container.socket'),
    ).toThrow(PermissionDeniedError);
  });
});
