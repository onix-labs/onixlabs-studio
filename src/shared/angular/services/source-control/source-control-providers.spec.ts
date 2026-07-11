import { TestBed } from '@angular/core/testing';

import { GitRunResult, SourceControlClient } from '@shared/api/source-control-channels';
import { GitProvider } from './git-provider';
import { SourceControl } from './source-control';
import { SourceControlProvider } from './source-control-provider';
import { SourceControlProviders } from './source-control-providers';

describe('SourceControlProviders', () => {
  let statusRoots: string[];

  /**
   * Configures the testing module with a stub source-control client that records status reads.
   * @param client The client the stubbed {@link SourceControl} exposes.
   * @returns Returns the resolved factory.
   */
  function setup(client: SourceControlClient | undefined): SourceControlProviders {
    TestBed.configureTestingModule({
      providers: [{ provide: SourceControl, useValue: { client } }],
    });
    return TestBed.inject(SourceControlProviders);
  }

  /**
   * Builds a stub client whose status call records its root and yields empty output.
   * @returns Returns the stub client.
   */
  function stubClient(): SourceControlClient {
    statusRoots = [];
    return {
      status: (root: string): Promise<GitRunResult> => {
        statusRoots.push(root);
        return Promise.resolve({ success: true, stdout: '' });
      },
    } as Partial<SourceControlClient> as SourceControlClient;
  }

  it('create_whenCalled_returnsAGitProviderBoundToTheRoot', () => {
    const factory: SourceControlProviders = setup(stubClient());

    const provider: SourceControlProvider = factory.create('/repos/studio');

    expect(provider).toBeInstanceOf(GitProvider);
    expect(provider.root).toBe('/repos/studio');
  });

  it('create_whenCalledPerRepository_returnsIndependentProviders', () => {
    const factory: SourceControlProviders = setup(stubClient());

    const first: SourceControlProvider = factory.create('/repos/one');
    const second: SourceControlProvider = factory.create('/repos/two');

    expect(first).not.toBe(second);
    expect(first.root).toBe('/repos/one');
    expect(second.root).toBe('/repos/two');
  });

  it('create_wiresTheSharedClientIntoTheProvider', async () => {
    const factory: SourceControlProviders = setup(stubClient());

    await factory.create('/repos/studio').getStatus();

    expect(statusRoots).toEqual(['/repos/studio']);
  });

  it('create_whenRunningOutsideElectron_yieldsAProviderWhoseReadsAreEmpty', async () => {
    const factory: SourceControlProviders = setup(undefined);

    const provider: SourceControlProvider = factory.create('/repos/studio');

    await expect(provider.getCommits(10)).resolves.toEqual([]);
  });
});
