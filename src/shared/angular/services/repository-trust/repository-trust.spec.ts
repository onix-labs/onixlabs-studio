import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bridge } from '@shared/api/bridge';
import type { RepositoryInfo, RepositoryTrustDecision } from '@shared/api/source-control-channels';
import { TrustChannel, type TrustChange } from '@shared/api/trust-channels';
import { RepositoryTrust } from './repository-trust';

describe('RepositoryTrust (#1504)', () => {
  let decisions: Map<string, RepositoryTrustDecision>;
  let asked: string[];
  let answer: RepositoryTrustDecision;
  let changed: ((change: unknown) => void) | null;
  let trust: RepositoryTrust;

  /**
   * Describes an opened repository with the given trust.
   * @param root The root.
   * @param decision The decision the main process reported.
   * @returns Returns the repository.
   */
  function info(root: string, decision: RepositoryTrustDecision): RepositoryInfo {
    return { root, name: root.slice(root.lastIndexOf('/') + 1), trust: decision };
  }

  beforeEach(() => {
    decisions = new Map<string, RepositoryTrustDecision>();
    asked = [];
    answer = 'trusted';
    changed = null;
    (window as unknown as { bridge: Bridge }).bridge = {
      invoke: <T>(channel: string, folder: string): Promise<T> => {
        if (channel === (TrustChannel.State as string)) {
          return Promise.resolve((decisions.get(folder) ?? 'unknown') as T);
        }
        if (channel === (TrustChannel.Ask as string)) {
          asked.push(folder);
          return Promise.resolve(answer as T);
        }
        return Promise.resolve(undefined as T);
      },
      send: vi.fn(),
      on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
        if (channel === (TrustChannel.Changed as string)) {
          changed = listener;
        }
        return (): void => undefined;
      },
    };
    TestBed.configureTestingModule({ providers: [RepositoryTrust] });
    trust = TestBed.inject(RepositoryTrust);
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: Bridge }).bridge;
  });

  it('ensureAsked_aboutAFolderNobodyDecidedAbout_hasTheMainProcessAsk', async () => {
    expect(await trust.ensureAsked('/work/shop')).toBe('trusted');

    expect(asked).toEqual(['/work/shop']);
  });

  it.each(['trusted', 'restricted'] as const)(
    'ensureAsked_aboutAFolderAlready_%s_asksNothing',
    async (decision: RepositoryTrustDecision) => {
      decisions.set('/work/shop', decision);

      expect(await trust.ensureAsked('/work/shop')).toBe(decision);

      expect(asked).toEqual([]);
    },
  );

  it('ensureTrusted_followsTheDecisionTheRepositoryCameWith', async () => {
    expect(await trust.ensureTrusted(info('/repos/a', 'trusted'))).toBe(true);
    expect(await trust.ensureTrusted(info('/repos/b', 'restricted'))).toBe(false);

    expect(asked).toEqual([]);
  });

  it('ensureTrusted_withNoDecision_asks_andFollowsTheAnswer', async () => {
    answer = 'restricted';

    expect(await trust.ensureTrusted(info('/repos/a', 'unknown'))).toBe(false);

    expect(asked).toEqual(['/repos/a']);
  });

  it('trust_asksAgain_evenForAFolderTheUserDeclined', async () => {
    decisions.set('/work/shop', 'restricted');

    expect(await trust.trust('/work/shop')).toBe(true);

    expect(asked).toEqual(['/work/shop']);
  });

  it('changed_followsTheMainProcesssAnnouncements', () => {
    expect(trust.changed()).toBeNull();
    const change: TrustChange = { folder: '/work/shop', decision: 'trusted' };

    changed?.(change);

    expect(trust.changed()).toEqual(change);
  });
});
