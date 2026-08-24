import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { ForgeChannel } from '@shared/api/forge-channels';
import { ForgeAuthStatus, ForgeRepositoryRef, ForgeResult } from '@shared/api/forge-types';
import { Forge } from './forge';

/**
 * The repository the listing calls are made for.
 */
const REPOSITORY: ForgeRepositoryRef = {
  kind: 'github',
  host: 'github.com',
  owner: 'onix-labs',
  name: 'onixlabs-studio',
};

/**
 * Records what was invoked over the bridge.
 */
interface Invocation {
  readonly channel: string;
  readonly args: readonly unknown[];
}

describe('Forge', () => {
  let invocations: Invocation[];

  /**
   * Installs a bridge that records invocations and replies with a fixed value.
   * @param reply The value every invoke resolves to.
   */
  function installBridge(reply: unknown): void {
    invocations = [];
    (window as { bridge?: Partial<Bridge> }).bridge = {
      invoke: (channel: string, ...args: unknown[]): Promise<unknown> => {
        invocations.push({ channel, args });
        return Promise.resolve(reply);
      },
    } as Partial<Bridge>;
  }

  /**
   * Removes the bridge, standing for Studio served as a plain web app.
   */
  function removeBridge(): void {
    delete (window as { bridge?: unknown }).bridge;
  }

  afterEach(() => {
    removeBridge();
  });

  describe('with a backend', () => {
    beforeEach(() => {
      installBridge(null);
    });

    it('detect_namesTheDetectChannel', async () => {
      installBridge(REPOSITORY);
      const forge: Forge = TestBed.inject(Forge);

      await expect(forge.detect('git@github.com:onix-labs/onixlabs-studio.git')).resolves.toEqual(
        REPOSITORY,
      );
      expect(invocations[0]).toEqual({
        channel: ForgeChannel.Detect,
        args: ['git@github.com:onix-labs/onixlabs-studio.git'],
      });
    });

    it('setToken_passesTheTokenToTheMainProcess', async () => {
      const forge: Forge = TestBed.inject(Forge);

      await forge.setToken('ghp_token');

      expect(invocations[0].channel).toBe(ForgeChannel.SetToken);
      expect(invocations[0].args).toEqual(['ghp_token']);
    });

    it('exposesNoWayToReadATokenBack', () => {
      // The seam's whole point: storing and clearing are requests; the secret never returns.
      const forge: Forge = TestBed.inject(Forge);
      const surface: Record<string, unknown> = forge as unknown as Record<string, unknown>;

      expect(surface['token']).toBeUndefined();
      expect(surface['getToken']).toBeUndefined();
      expect(Object.keys(ForgeChannel).some((key: string): boolean => key.includes('Get'))).toBe(
        false,
      );
    });

    it('listingCalls_nameTheirChannelsAndCarryTheRepository', async () => {
      const forge: Forge = TestBed.inject(Forge);

      await forge.pullRequests(REPOSITORY);
      await forge.issues(REPOSITORY);
      await forge.workflowRuns(REPOSITORY);

      expect(invocations.map((call: Invocation): string => call.channel)).toEqual([
        ForgeChannel.PullRequests,
        ForgeChannel.Issues,
        ForgeChannel.WorkflowRuns,
      ]);
      expect(invocations.every((call: Invocation): boolean => call.args[0] === REPOSITORY)).toBe(
        true,
      );
    });

    it('reportsItselfAvailable', () => {
      expect(TestBed.inject(Forge).isAvailable).toBe(true);
    });
  });

  describe('without a backend', () => {
    beforeEach(() => {
      removeBridge();
    });

    it('reportsItselfUnavailable', () => {
      expect(TestBed.inject(Forge).isAvailable).toBe(false);
    });

    it('degradesToAnUnavailableStatus_ratherThanThrowing', async () => {
      const forge: Forge = TestBed.inject(Forge);

      const result: ForgeAuthStatus = await forge.authStatus();

      expect(result.authenticated).toBe(false);
      expect(result.detail).toContain('unavailable');
    });

    it('degradesListingCallsToAFailedResult_soCallersNeedNoEnvironmentCheck', async () => {
      const forge: Forge = TestBed.inject(Forge);

      const result: ForgeResult<unknown> = await forge.pullRequests(REPOSITORY);

      expect(result.ok).toBe(false);
      // Not an authentication problem: there is nothing here to sign in to.
      expect(result.ok === false && result.unauthorized).toBe(false);
    });

    it('detect_resolvesNull', async () => {
      await expect(TestBed.inject(Forge).detect('https://github.com/a/b.git')).resolves.toBeNull();
    });
  });
});
