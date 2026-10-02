import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { Organisation, OrganisationUser } from '@shared/api/organisation';
import { OrganisationChannel } from '@shared/api/organisation-channels';
import { OrganisationFiles } from './organisation-files';

/**
 * Records what was invoked over the bridge.
 */
interface Invocation {
  readonly channel: string;
  readonly args: readonly unknown[];
}

describe('OrganisationFiles', () => {
  const organisation: Organisation = { roles: [], agents: [] };
  const user: OrganisationUser = { agents: [] };

  afterEach(() => {
    delete (window as { bridge?: unknown }).bridge;
  });

  it('namesItsChannels_andCarriesTheRootAndPayload', async () => {
    const invocations: Invocation[] = [];
    (window as { bridge?: Partial<Bridge> }).bridge = {
      invoke: (channel: string, ...args: unknown[]): Promise<unknown> => {
        invocations.push({ channel, args });
        return Promise.resolve(null);
      },
    } as Partial<Bridge>;
    const files: OrganisationFiles = TestBed.inject(OrganisationFiles);

    await files.load('/dev/studio');
    await files.save('/dev/studio', organisation);
    await files.saveUser('/dev/studio', user);

    expect(invocations).toEqual([
      { channel: OrganisationChannel.Load, args: ['/dev/studio'] },
      { channel: OrganisationChannel.Save, args: ['/dev/studio', organisation] },
      { channel: OrganisationChannel.SaveUser, args: ['/dev/studio', user] },
    ]);
  });

  it('answersAsThoughNothingWereOpen_outsideElectron', async () => {
    const files: OrganisationFiles = TestBed.inject(OrganisationFiles);

    expect(await files.load('/dev/studio')).toBeNull();
    expect(await files.save('/dev/studio', organisation)).toBeNull();
    expect(await files.saveUser('/dev/studio', user)).toBeNull();
  });
});
