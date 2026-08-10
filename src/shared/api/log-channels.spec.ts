import { describe, expect, it } from 'vitest';
import { consoleLevelToSeverity, LogLevel, Severity } from './log-channels';

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
