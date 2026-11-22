import {
  DEFAULT_STARTUP_SETTINGS,
  parseStartupSettings,
  StartupSettings,
} from './startup-settings';

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

describe('parseStartupSettings interface zoom', () => {
  it('startsAt100', () => {
    expect(DEFAULT_STARTUP_SETTINGS.interfaceZoom).toBe(100);
  });

  it('keepsAFixedLevel', () => {
    expect(parseStartupSettings({ interfaceZoom: 75 }).interfaceZoom).toBe(75);
    expect(parseStartupSettings({ interfaceZoom: 200 }).interfaceZoom).toBe(200);
  });

  it('fallsBackTo100_forALevelNoOneChecked', () => {
    expect(parseStartupSettings({ interfaceZoom: 300 }).interfaceZoom).toBe(100);
    expect(parseStartupSettings({ interfaceZoom: '150' }).interfaceZoom).toBe(100);
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

describe('parseStartupSettings AI Manager', () => {
  it('keepsWhatTheSettingsOffer', () => {
    const parsed: StartupSettings = parseStartupSettings({
      ollamaAddress: '10.0.0.5:11434',
      ollamaStopOnQuit: 'never',
      ollamaStart: 'launch',
      ollamaKeepAliveMinutes: -1,
    });
    expect(parsed).toMatchObject({
      ollamaAddress: '10.0.0.5:11434',
      ollamaStopOnQuit: 'never',
      ollamaStart: 'launch',
      ollamaKeepAliveMinutes: -1,
    });
  });

  it('fallsBackOnTheDefaults', () => {
    expect(parseStartupSettings({ ollamaStart: 'sometimes', ollamaAddress: 7 })).toMatchObject({
      ollamaStart: 'needed',
      ollamaAddress: '127.0.0.1:11434',
    });
  });
});

describe('parseStartupSettings polled folders', () => {
  it('keepsTheFoldersAndAnOfferedInterval', () => {
    const parsed: StartupSettings = parseStartupSettings({
      pollingFolders: ['/Volumes/Share/', '/mnt/nfs'],
      pollingInterval: 5,
    });

    expect(parsed.pollingFolders).toEqual(['/Volumes/Share', '/mnt/nfs']);
    expect(parsed.pollingInterval).toBe(5);
  });

  it('dropsWhatIsNotAnAbsoluteFolder_andAnIntervalNotOffered', () => {
    const parsed: StartupSettings = parseStartupSettings({
      pollingFolders: ['relative', 7, ''],
      pollingInterval: 3,
    });

    expect(parsed.pollingFolders).toEqual([]);
    expect(parsed.pollingInterval).toBe(2);
  });
});
