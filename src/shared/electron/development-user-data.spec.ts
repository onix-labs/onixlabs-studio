import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { DevelopmentUserData, useDevelopmentUserData } from './development-user-data';

describe('useDevelopmentUserData', () => {
  let root: string;
  let installed: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-dev-user-data-'));
    installed = path.join(root, 'onixlabs-studio');
    fs.mkdirSync(installed);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /**
   * Writes a file into the installed profile.
   * @param entry The file's path within the profile.
   * @param text The file's contents.
   */
  function write(entry: string, text: string): void {
    fs.mkdirSync(path.dirname(path.join(installed, entry)), { recursive: true });
    fs.writeFileSync(path.join(installed, entry), text);
  }

  it('usesADirectoryBesideTheInstalledProfile', () => {
    const result: DevelopmentUserData = useDevelopmentUserData(installed);

    expect(result.directory).toBe(`${installed}-dev`);
    expect(fs.existsSync(result.directory)).toBe(true);
  });

  it('seedsStudiosOwnFiles_theFirstTime', () => {
    write('plugins/onixlabs.git/main.js', 'plugin');
    write('trusted-paths.json', '[]');

    const result: DevelopmentUserData = useDevelopmentUserData(installed);

    expect(result.seeded).toEqual(['plugins', 'trusted-paths.json']);
    expect(
      fs.readFileSync(path.join(result.directory, 'plugins/onixlabs.git/main.js'), 'utf8'),
    ).toBe('plugin');
  });

  it('leavesChromiumsStorage_logsAndCredentialsBehind', () => {
    write('Local Storage/leveldb/LOCK', '');
    write('logs/studio.log', 'log');
    write('forge-credentials.bin', 'secret');
    write('agent-conversations/one.json', '{}');

    const result: DevelopmentUserData = useDevelopmentUserData(installed);

    expect(fs.readdirSync(result.directory)).toEqual([]);
  });

  it('repointsTheSeededInstallRecords_atTheDevelopmentProfile', () => {
    write(
      'plugins.json',
      JSON.stringify([{ id: 'clangd', installedPath: path.join(installed, 'lsp-servers/clangd') }]),
    );

    const result: DevelopmentUserData = useDevelopmentUserData(installed);

    const records: { installedPath: string }[] = JSON.parse(
      fs.readFileSync(path.join(result.directory, 'plugins.json'), 'utf8'),
    ) as { installedPath: string }[];
    expect(records[0].installedPath).toBe(path.join(result.directory, 'lsp-servers/clangd'));
  });

  it('seedsNothing_onceTheDevelopmentProfileExists', () => {
    useDevelopmentUserData(installed);
    write('trusted-paths.json', '[]');

    const result: DevelopmentUserData = useDevelopmentUserData(installed);

    expect(result.seeded).toEqual([]);
    expect(fs.existsSync(path.join(result.directory, 'trusted-paths.json'))).toBe(false);
  });
});
