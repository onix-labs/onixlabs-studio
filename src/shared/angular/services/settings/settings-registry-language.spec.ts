import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SettingDef } from './settings-schema';

/**
 * Loads a fresh copy of the settings registry as a build of the given kind reads it. The registry
 * decides whether the Language setting is offered as its module is first read, so each case needs
 * its own copy.
 * @param packaged Whether to load it as a packaged build.
 * @returns Returns the Language setting's definition and whether it applies on this platform.
 */
async function languageSettingIn(
  packaged: boolean,
): Promise<{ readonly setting: SettingDef | undefined; readonly shown: boolean }> {
  vi.resetModules();
  vi.stubGlobal('host', { ...window.host, packaged, platform: 'darwin' });
  const { SETTINGS_BY_KEY }: typeof import('./settings-registry') =
    await import('./settings-registry');
  const { appliesToPlatform }: typeof import('./settings-schema') =
    await import('./settings-schema');
  const setting: SettingDef | undefined = SETTINGS_BY_KEY.get('application.language');
  return { setting, shown: setting !== undefined && appliesToPlatform(setting) };
}

describe('the Language setting', (): void => {
  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('should be shown in a development build', async (): Promise<void> => {
    const { shown }: { readonly shown: boolean } = await languageSettingIn(false);
    expect(shown).toBe(true);
  });

  it('should stay registered but hidden in a packaged build', async (): Promise<void> => {
    const {
      setting,
      shown,
    }: { readonly setting: SettingDef | undefined; readonly shown: boolean } =
      await languageSettingIn(true);
    expect(setting).toBeDefined();
    expect(shown).toBe(false);
  });
});
