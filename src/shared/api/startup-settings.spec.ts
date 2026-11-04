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
    ).toEqual({
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
