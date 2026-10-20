import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The store lives in the user-data directory, which only Electron can answer for; a temporary
// directory stands in for it.
vi.mock('electron', () => ({
  app: { getPath: (): string => tmpdir(), isPackaged: true },
  ipcMain: { on: (): void => undefined, handle: (): void => undefined },
}));

const { StartupPreferencesStore } = await import('./startup-preferences');

/**
 * Holds the path the store reads and writes, under the stubbed user-data directory.
 */
const FILE: string = join(tmpdir(), 'startup-preferences.json');

describe('StartupPreferencesStore', () => {
  afterEach(() => {
    rmSync(FILE, { force: true });
  });

  it('write_mergesOverWhatIsPersisted_soOnePreferenceNeverResetsAnother', () => {
    StartupPreferencesStore.write({ logLevel: 'debug' });
    StartupPreferencesStore.write({ graphicsAcceleration: 'limited' });

    expect(StartupPreferencesStore.read()).toEqual({
      graphicsAcceleration: 'limited',
      logLevel: 'debug',
      loadSideloadedPlugins: null,
    });
  });

  it('read_whenTheLogLevelIsNotOneItKnows_reportsNone', () => {
    writeFileSync(FILE, JSON.stringify({ graphicsAcceleration: 'full', logLevel: 'verbose' }));

    expect(StartupPreferencesStore.read()).toEqual({
      graphicsAcceleration: 'full',
      logLevel: null,
      loadSideloadedPlugins: null,
    });
  });

  it('read_whenNothingIsPersisted_reportsTheDefaults', () => {
    expect(StartupPreferencesStore.read()).toEqual({
      graphicsAcceleration: null,
      logLevel: null,
      loadSideloadedPlugins: null,
    });
  });

  it('write_keepsTheSideloadingChoice_andReadsItBack', () => {
    StartupPreferencesStore.write({ loadSideloadedPlugins: true });

    expect(StartupPreferencesStore.read().loadSideloadedPlugins).toBe(true);
  });

  it('read_whenTheSideloadingChoiceIsNotABoolean_reportsNone', () => {
    writeFileSync(FILE, JSON.stringify({ loadSideloadedPlugins: 'yes' }));

    expect(StartupPreferencesStore.read().loadSideloadedPlugins).toBeNull();
  });
});
