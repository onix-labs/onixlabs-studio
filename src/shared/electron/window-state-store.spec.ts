import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Holds the user-data directory the fake Electron answers with.
 */
const electron: { userData: string } = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({ app: { getPath: (): string => electron.userData } }));

const { WindowStateStore } = await import('./window-state-store');

/**
 * Holds a usable state.
 */
const STATE: { bounds: object; maximized: boolean; fullScreen: boolean } = {
  bounds: { x: 10, y: 20, width: 800, height: 600 },
  maximized: false,
  fullScreen: false,
};

describe('WindowStateStore', () => {
  /**
   * Gets the path of the store's file.
   * @returns Returns the path.
   */
  function file(): string {
    return path.join(electron.userData, 'window-state.json');
  }

  beforeEach(() => {
    electron.userData = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'window-state-')));
  });

  afterEach(() => {
    fs.chmodSync(electron.userData, 0o700);
    fs.rmSync(electron.userData, { recursive: true, force: true });
  });

  it('read_withNothingStored_answersNull', () => {
    expect(WindowStateStore.read('main')).toBeNull();
  });

  it('write_thenRead_roundTrips', () => {
    WindowStateStore.write('main', STATE as never);

    expect(WindowStateStore.read('main')).toMatchObject({ bounds: STATE.bounds });
  });

  it('write_keepsTheOtherKinds', () => {
    WindowStateStore.write('main', STATE as never);
    WindowStateStore.write('popout', STATE as never);

    expect(WindowStateStore.read('main')).not.toBeNull();
    expect(WindowStateStore.read('popout')).not.toBeNull();
    expect(WindowStateStore.read('modal')).toBeNull();
  });

  it.each([['{ corrupt'], ['[]'], ['null'], ['7'], ['{"main":{"bounds":"nowhere"}}'], ['']])(
    'read_ofAnUnusableFile_answersNull %#',
    (contents: string) => {
      fs.writeFileSync(file(), contents);

      expect(WindowStateStore.read('main')).toBeNull();
    },
  );

  it('write_overACorruptFile_startsAfresh', () => {
    fs.writeFileSync(file(), '{ corrupt');

    WindowStateStore.write('main', STATE as never);

    expect(WindowStateStore.read('main')).not.toBeNull();
  });

  it('read_ofAPathThatIsADirectory_answersNull', () => {
    fs.mkdirSync(file());

    expect(WindowStateStore.read('main')).toBeNull();
  });

  it('write_toAnUnwritableStore_doesNotThrow', () => {
    fs.mkdirSync(file());

    expect((): void => WindowStateStore.write('main', STATE as never)).not.toThrow();
  });
});
