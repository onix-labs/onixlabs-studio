import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { PluginContribution } from '@shared/api/plugin-channels';
import { PluginInstallRecord, PluginStore } from './plugin-store';

describe('PluginStore', () => {
  let directory: string;

  const contributions: readonly PluginContribution[] = [
    {
      slot: 'version-control',
      id: 'git',
      displayName: 'Git',
      priority: 100,
      capabilities: ['clone'],
    },
  ];

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'studio-plugin-store-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  /**
   * Writes the store file by hand, as an older build or a hand edit would have left it.
   * @param records The stored value.
   */
  function storeFile(records: unknown): void {
    writeFileSync(path.join(directory, 'plugins.json'), JSON.stringify(records));
  }

  it('add_keepsWhatTheInstallContributes_acrossALaunch', () => {
    new PluginStore(directory).add({
      id: 'git',
      version: '0.2.0',
      installedPath: '/installed/git',
      contributions,
    });

    expect(new PluginStore(directory).get('git')?.contributions).toEqual(contributions);
  });

  it('load_aRecordFromBeforeSnapshots_isKeptWithoutContributions', () => {
    storeFile([{ id: 'git', version: '0.2.0', installedPath: '/installed/git' }]);

    expect(new PluginStore(directory).get('git')).toEqual({
      id: 'git',
      version: '0.2.0',
      installedPath: '/installed/git',
    });
  });

  it('load_aMalformedSnapshot_costsTheSnapshotButNotTheRecord', () => {
    storeFile([
      { id: 'git', version: '0.2.0', installedPath: '/installed/git', contributions: [{ id: 3 }] },
    ]);

    const record: PluginInstallRecord | null = new PluginStore(directory).get('git');

    expect(record?.version).toBe('0.2.0');
    expect(record?.contributions).toBeUndefined();
  });
});
