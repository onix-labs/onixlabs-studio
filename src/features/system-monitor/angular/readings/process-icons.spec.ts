import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { SystemMonitorMetrics } from '../metrics/system-monitor-metrics';
import { ProcessIcons } from './process-icons';

describe('ProcessIcons', () => {
  it('asksForEachAppsIconOnce_andAnswersWithItOnceItArrives', async () => {
    const asked: string[] = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SystemMonitorMetrics,
          useValue: {
            processIcon: (location: string, name: string): Promise<string | null> => {
              asked.push(`${location}/${name}`);
              return Promise.resolve(name === 'Arc' ? 'data:image/png;base64,AAAA' : null);
            },
          },
        },
      ],
    });
    const icons: ProcessIcons = TestBed.inject(ProcessIcons);

    // Not read yet: no icon, and one request whatever the number of asks.
    expect(icons.icon('/Applications/Arc.app/Contents/MacOS', 'Arc')).toBeNull();
    expect(icons.icon('/Applications/Arc.app/Contents/MacOS', 'Arc')).toBeNull();
    expect(icons.icon('/usr/sbin', 'cfprefsd')).toBeNull();
    await Promise.resolve();

    expect(icons.icon('/Applications/Arc.app/Contents/MacOS', 'Arc')).toBe(
      'data:image/png;base64,AAAA',
    );
    expect(icons.icon('/usr/sbin', 'cfprefsd')).toBeNull();
    expect(asked).toEqual(['/Applications/Arc.app/Contents/MacOS/Arc', '/usr/sbin/cfprefsd']);
  });

  it('asksForNothing_withoutAFolderToLookIn', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: SystemMonitorMetrics, useValue: {} }],
    });

    expect(TestBed.inject(ProcessIcons).icon(undefined, 'kernel_task')).toBeNull();
  });
});
