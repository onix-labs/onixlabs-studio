import { TestBed } from '@angular/core/testing';

import { SourceControlClient } from '@shared/api/source-control-channels';
import { VersionControlOp, VersionControlResponse } from '@shared/api/version-control-protocol';
import { SourceControl } from './source-control';
import { SourceControlProvider } from './source-control-provider';
import { SourceControlProviders } from './source-control-providers';
import { VersionControlProvider } from './version-control-provider';

describe('SourceControlProviders', () => {
  let requests: { root: string; op: VersionControlOp }[];

  /**
   * Configures the testing module with a stub source-control client.
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
   * Builds a stub client whose requests are recorded and fail, so reads come back empty.
   * @returns Returns the stub client.
   */
  function stubClient(): SourceControlClient {
    requests = [];
    return {
      resolveRepository: (): Promise<null> => Promise.resolve(null),
      closeRepository: (): Promise<void> => Promise.resolve(),
      describe: (): Promise<null> => Promise.resolve(null),
      detect: (): Promise<null> => Promise.resolve(null),
      listPlugins: (): Promise<readonly []> => Promise.resolve([]),
      setExecutable: (): Promise<null> => Promise.resolve(null),
      request: <Op extends VersionControlOp>(
        root: string,
        op: Op,
      ): Promise<VersionControlResponse<Op>> => {
        requests.push({ root, op });
        return Promise.resolve({ id: 0, ok: false, error: 'stub' });
      },
    };
  }

  it('create_whenCalled_returnsAVersionControlProviderBoundToTheRoot', () => {
    const factory: SourceControlProviders = setup(stubClient());

    const provider: SourceControlProvider = factory.create('/repos/studio');

    expect(provider).toBeInstanceOf(VersionControlProvider);
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

    expect(requests).toEqual([{ root: '/repos/studio', op: 'status' }]);
  });

  it('create_whenRunningOutsideElectron_yieldsAProviderWhoseReadsAreEmpty', async () => {
    const factory: SourceControlProviders = setup(undefined);

    const provider: SourceControlProvider = factory.create('/repos/studio');

    await expect(provider.getCommits(10)).resolves.toEqual([]);
  });
});
