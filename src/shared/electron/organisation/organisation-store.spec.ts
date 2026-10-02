import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Organisation, OrganisationUser } from '@shared/api/organisation';
import { OrganisationChannel, OrganisationSnapshot } from '@shared/api/organisation-channels';
import { OrganisationStore } from './organisation-store';

describe('OrganisationStore', () => {
  let root: string;
  let store: OrganisationStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'organisation-store-'));
    store = new OrganisationStore((candidate: string): boolean => candidate === root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Reads a file under the root's `.studio` folder.
   * @param file The file name.
   * @returns Returns its parsed contents.
   */
  function studioFile(file: string): unknown {
    return JSON.parse(readFileSync(join(root, '.studio', file), 'utf8'));
  }

  it('registersItsThreeChannels', () => {
    const channels: string[] = [];

    store.register({ handle: (channel: string): void => void channels.push(channel) });

    expect(channels.sort()).toEqual(
      [OrganisationChannel.Load, OrganisationChannel.Save, OrganisationChannel.SaveUser].sort(),
    );
  });

  it('loadsTheDefaults_whenNeitherFileExists', async () => {
    const snapshot: OrganisationSnapshot | null = await store.load(root);

    expect(snapshot?.organisation.agents).toEqual([]);
    expect(snapshot?.organisation.roles.length).toBeGreaterThan(0);
    expect(snapshot?.user).toEqual({ agents: [] });
  });

  it('refusesARootThatIsNotOpen', async () => {
    const elsewhere: string = mkdtempSync(join(tmpdir(), 'organisation-elsewhere-'));
    try {
      expect(await store.load(elsewhere)).toBeNull();
      expect(await store.save(elsewhere, { agents: [] })).toBeNull();
      expect(await store.saveUser(elsewhere, { agents: [] })).toBeNull();
      expect(await store.load(42)).toBeNull();
      expect(existsSync(join(elsewhere, '.studio'))).toBe(false);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('savesTheRoster_sanitisedAndReturnedAsWritten', async () => {
    const written: Organisation | null = await store.save(root, {
      roles: [],
      agents: [
        { id: 'ada', name: ' Ada ', roleId: 'engineer' },
        { id: '../evil', name: 'Evil', roleId: 'engineer' },
      ],
    });

    expect(written?.agents).toEqual([{ id: 'ada', name: 'Ada', roleId: 'engineer' }]);
    expect(studioFile('organisation.json')).toEqual({
      version: 1,
      roles: [],
      agents: [{ id: 'ada', name: 'Ada', roleId: 'engineer' }],
    });
    expect((await store.load(root))?.organisation.agents).toEqual(written?.agents);
  });

  it('savesThePerDeveloperState_andKeepsItOutOfGit', async () => {
    const written: OrganisationUser | null = await store.saveUser(root, {
      agents: [{ agentId: 'ada', workItem: 795, conversationId: null }],
    });

    expect(written).toEqual({ agents: [{ agentId: 'ada', workItem: 795, conversationId: null }] });
    expect((await store.load(root))?.user).toEqual(written);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('.studio/*.user.json');
  });

  it('degradesAMalformedFile_toTheDefaults', async () => {
    mkdirSync(join(root, '.studio'));
    writeFileSync(join(root, '.studio', 'organisation.json'), '{ not json');

    expect((await store.load(root))?.organisation.agents).toEqual([]);
  });
});
