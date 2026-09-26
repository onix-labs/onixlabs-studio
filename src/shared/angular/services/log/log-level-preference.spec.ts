import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LogLevelSetting } from '@shared/api/log-channels';
import { Settings } from '@shared/angular/services/settings/settings';
import { Log } from './log';
import { LogLevelPreference } from './log-level-preference';

describe('LogLevelPreference', () => {
  afterEach((): void => {
    // Settings persist to localStorage, which outlives each test (specs run with isolate=false).
    window.localStorage.removeItem('settings');
  });

  it('appliesTheSettingAtStartUp_andOnEveryChange', () => {
    const applied: LogLevelSetting[] = [];
    vi.spyOn(TestBed.inject(Log), 'setLevel').mockImplementation(
      (setting: LogLevelSetting): Promise<void> => {
        applied.push(setting);
        return Promise.resolve();
      },
    );

    TestBed.inject(LogLevelPreference);
    TestBed.tick();
    TestBed.inject(Settings).set('application.logLevel', 'debug');
    TestBed.tick();

    expect(applied).toEqual(['auto', 'debug']);
  });
});
