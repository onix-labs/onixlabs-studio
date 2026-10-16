import { TestBed } from '@angular/core/testing';
import {
  RepositoryInfo,
  RepositoryTrustDecision,
  SourceControlClient,
} from '@shared/api/source-control-channels';
import { SourceControl } from '@shared/angular/services/source-control/source-control';
import { RepositoryTrust } from './repository-trust';

describe('RepositoryTrust', () => {
  let recorded: { root: string; decision: string }[];
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

  /**
   * Lets the pending promises settle.
   * @returns Returns a promise that resolves after a macrotask.
   */
  function settle(): Promise<void> {
    return new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }

  beforeEach(() => {
    recorded = [];
    const client: Pick<SourceControlClient, 'setTrust'> = {
      setTrust: (root: string, decision: 'trusted' | 'restricted') => {
        recorded.push({ root, decision });
        return Promise.resolve(decision);
      },
    };
    TestBed.configureTestingModule({
      providers: [
        RepositoryTrust,
        { provide: SourceControl, useValue: { client: client as SourceControlClient } },
      ],
    });
    trust = TestBed.inject(RepositoryTrust);
  });

  it('ensureTrusted_answersADecidedRepositoryWithoutAsking', async () => {
    expect(await trust.ensureTrusted(info('/repos/a', 'trusted'))).toBe(true);
    expect(await trust.ensureTrusted(info('/repos/b', 'restricted'))).toBe(false);
    expect(trust.pending()).toBeNull();
    expect(recorded).toEqual([]);
  });

  it('ensureTrusted_asksAboutAnUndecidedRepository_andRecordsTheAnswer', async () => {
    const asked: Promise<boolean> = trust.ensureTrusted(info('/repos/a', 'unknown'));
    await settle();
    expect(trust.pending()).toEqual({ root: '/repos/a', name: 'a' });

    trust.accept();

    expect(await asked).toBe(true);
    expect(trust.pending()).toBeNull();
    expect(recorded).toEqual([{ root: '/repos/a', decision: 'trusted' }]);
  });

  it('decline_recordsTheRepositoryAsRestricted', async () => {
    const asked: Promise<boolean> = trust.ensureTrusted(info('/repos/a', 'unknown'));
    await settle();

    trust.decline();

    expect(await asked).toBe(false);
    expect(recorded).toEqual([{ root: '/repos/a', decision: 'restricted' }]);
  });

  it('ensureTrusted_sharesOneQuestionBetweenSurfacesOpeningTheSameRepository', async () => {
    // The explorer decorations and the Repository panel open the same repository independently.
    const first: Promise<boolean> = trust.ensureTrusted(info('/repos/a', 'unknown'));
    const second: Promise<boolean> = trust.ensureTrusted(info('/repos/a', 'unknown'));
    await settle();

    trust.accept();

    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(recorded).toHaveLength(1);
  });

  it('ensureTrusted_asksAboutDifferentRepositoriesOneAtATime', async () => {
    const first: Promise<boolean> = trust.ensureTrusted(info('/repos/a', 'unknown'));
    const second: Promise<boolean> = trust.ensureTrusted(info('/repos/b', 'unknown'));
    await settle();
    expect(trust.pending()?.root).toBe('/repos/a');

    trust.decline();
    await settle();
    expect(trust.pending()?.root).toBe('/repos/b');

    trust.accept();

    expect(await Promise.all([first, second])).toEqual([false, true]);
    expect(recorded).toEqual([
      { root: '/repos/a', decision: 'restricted' },
      { root: '/repos/b', decision: 'trusted' },
    ]);
  });

  it('trust_recordsALaterGrant', async () => {
    expect(await trust.trust('/repos/a')).toBe(true);
    expect(recorded).toEqual([{ root: '/repos/a', decision: 'trusted' }]);
  });

  it('record_whenTheMainProcessRefuses_reportsNotTrusted', async () => {
    const refusing: Pick<SourceControlClient, 'setTrust'> = {
      setTrust: (): Promise<RepositoryTrustDecision> => Promise.resolve('unknown'),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        RepositoryTrust,
        { provide: SourceControl, useValue: { client: refusing as SourceControlClient } },
      ],
    });
    const service: RepositoryTrust = TestBed.inject(RepositoryTrust);

    expect(await service.trust('/repos/a')).toBe(false);
  });
});
