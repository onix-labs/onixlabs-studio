import { describe, expect, it } from 'vitest';
import {
  consoleLevelToSeverity,
  LogLevel,
  LogLevelSetting,
  meetsFloor,
  resolveLogFloor,
  Severity,
} from './log-channels';

describe('consoleLevelToSeverity', () => {
  it.each<[LogLevel, Severity]>([
    ['log', 'info'],
    ['info', 'info'],
    ['warn', 'warning'],
    ['error', 'error'],
    ['debug', 'debug'],
  ])('maps the %s console level to the %s severity', (level: LogLevel, severity: Severity) => {
    expect(consoleLevelToSeverity(level)).toBe(severity);
  });
});

describe('meetsFloor', () => {
  it('keepsTheFloorAndAbove_andDropsBelowIt', () => {
    expect(meetsFloor('info', 'info')).toBe(true);
    expect(meetsFloor('error', 'info')).toBe(true);
    expect(meetsFloor('debug', 'info')).toBe(false);
    expect(meetsFloor('trace', 'trace')).toBe(true);
  });
});

describe('resolveLogFloor', () => {
  it.each<[string | undefined, LogLevelSetting | null, boolean, Severity]>([
    // The build's default when nothing is chosen: quiet in a release, unchanged in development.
    [undefined, null, true, 'info'],
    [undefined, null, false, 'trace'],
    [undefined, 'auto', true, 'info'],
    // The setting, when it names a level.
    [undefined, 'debug', true, 'debug'],
    [undefined, 'warning', false, 'warning'],
    // The environment variable wins, case-insensitively, with `warn` accepted.
    ['trace', 'error', true, 'trace'],
    [' DEBUG ', null, true, 'debug'],
    ['warn', null, false, 'warning'],
    // An environment value that names no severity is ignored.
    ['verbose', 'debug', true, 'debug'],
    ['', null, true, 'info'],
  ])(
    'environment %j, setting %j, packaged %s resolves to %s',
    (
      environment: string | undefined,
      setting: LogLevelSetting | null,
      packaged: boolean,
      floor: Severity,
    ) => {
      expect(resolveLogFloor(environment, setting, packaged)).toBe(floor);
    },
  );
});
