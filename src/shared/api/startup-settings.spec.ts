import { DEFAULT_STARTUP_SETTINGS, parseStartupSettings } from './startup-settings';

describe('parseStartupSettings', () => {
  it('withNothing_returnsTheDefaults', () => {
    expect(parseStartupSettings(undefined)).toEqual(DEFAULT_STARTUP_SETTINGS);
    expect(parseStartupSettings('settings')).toEqual(DEFAULT_STARTUP_SETTINGS);
  });

  it('withKnownValues_keepsThem', () => {
    expect(
      parseStartupSettings({
        quitWhenLastWindowCloses: 'quit',
        windowSizeOnLaunch: 'default',
        restoreFullScreen: false,
        cornerStyle: 'square',
        confirmExternalLinks: 'always',
        addStudioUserFileToGitignore: false,
        projectScanDepth: 5,
      }),
    ).toMatchObject({
      addStudioUserFileToGitignore: false,
      projectScanDepth: 5,
      quitWhenLastWindowCloses: 'quit',
      windowSizeOnLaunch: 'default',
      restoreFullScreen: false,
      cornerStyle: 'square',
      confirmExternalLinks: 'always',
    });
  });

  it('withUnknownValues_fallsBackPerSetting', () => {
    expect(
      parseStartupSettings({
        windowSizeOnLaunch: 'huge',
        restoreFullScreen: 'yes',
        cornerStyle: 'rounded',
      }),
    ).toEqual({ ...DEFAULT_STARTUP_SETTINGS, cornerStyle: 'rounded' });
  });
});

describe('parseStartupSettings log limits', () => {
  it('keeps a value the setting offers', () => {
    expect(parseStartupSettings({ logFileSizeMb: 50 }).logFileSizeMb).toBe(50);
    expect(parseStartupSettings({ keepSessionLogsDays: 0 }).keepSessionLogsDays).toBe(0);
  });

  it('falls back on the default for one it does not', () => {
    expect(parseStartupSettings({ logRotatedCopies: 99 }).logRotatedCopies).toBe(5);
    expect(parseStartupSettings({ liveLogRecords: '5000' }).liveLogRecords).toBe(5000);
  });
});
