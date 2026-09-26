import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { LogRecord } from '@shared/api/log-channels';

// The logger reaches the user-data directory for its archive and asks whether the build is packaged
// to decide where human-readable lines go; neither matters to the floor, so the application object is
// stubbed rather than the test being run under Electron. Packaged, so no line lands on stdout.
vi.mock('electron', () => ({
  app: { getPath: (): string => tmpdir(), isPackaged: true },
  ipcMain: { on: (): void => undefined, handle: (): void => undefined },
}));

const { Logger } = await import('./logger');

/**
 * Builds a detail value that counts how often it is serialised, so a test can prove a dropped record
 * never had its message built.
 * @returns Returns the detail and a reader for its serialisation count.
 */
function countingDetail(): { detail: { toJSON: () => string }; count: () => number } {
  let serialized: number = 0;
  return {
    detail: {
      toJSON: (): string => {
        serialized += 1;
        return 'detail';
      },
    },
    count: (): number => serialized,
  };
}

/**
 * Lists the messages a logger has recorded this session.
 * @param logger The logger to read.
 * @returns Returns the recorded messages, oldest first.
 */
function messages(logger: InstanceType<typeof Logger>): string[] {
  return logger.query({}).map((record: LogRecord): string => record.message);
}

describe('Logger severity floor', () => {
  it('belowTheFloor_dropsTheRecordWithoutBuildingItsMessage', () => {
    const logger: InstanceType<typeof Logger> = new Logger();
    logger.setFloor('info');
    const { detail, count } = countingDetail();

    logger.trace('Src', 'trace', detail);
    logger.debug('Src', 'debug', detail);
    logger.info('Src', 'info');
    logger.warn('Src', 'warning');

    expect(count()).toBe(0);
    expect(messages(logger)).toEqual(['info', 'warning']);
  });

  it('belowTheFloor_dropsAlreadyBuiltRecordsToo', () => {
    // The renderer's records and the legacy console shape arrive built; the floor still holds.
    const logger: InstanceType<typeof Logger> = new Logger();
    logger.setFloor('warning');

    logger.log({ origin: 'renderer', severity: 'debug', source: 'Src', message: 'debug' });
    logger.write('renderer', 'log', 'console log');
    logger.log({ origin: 'renderer', severity: 'error', source: 'Src', message: 'error' });

    expect(messages(logger)).toEqual(['error']);
  });

  it('atTrace_recordsEverything_asBeforeTheFloorExisted', () => {
    const logger: InstanceType<typeof Logger> = new Logger();
    logger.setFloor('trace');

    logger.trace('Src', 'trace');
    logger.debug('Src', 'debug');
    logger.error('Src', 'error');

    expect(messages(logger)).toEqual(['trace', 'debug', 'error']);
    expect(logger.severityFloor).toBe('trace');
    expect(logger.enabled('trace')).toBe(true);
  });

  it('errors_areRecordedAtEveryFloor', () => {
    const logger: InstanceType<typeof Logger> = new Logger();
    logger.setFloor('error');

    logger.warn('Src', 'warning');
    logger.error('Src', 'error');

    expect(messages(logger)).toEqual(['error']);
  });
});
