import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProcessesSnapshot, ProcessSample } from '@shared/api/system-monitor-channels';
import { SystemMonitorMetrics } from '../../metrics/system-monitor-metrics';
import { SystemMonitorProcesses } from '../../readings/system-monitor-processes';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { ProcessesTab } from './processes-tab';

/**
 * The processes listed in every test: Studio's main process, a shell it started, and two others.
 */
const PROCESSES: readonly ProcessSample[] = [
  {
    pid: 300,
    parentPid: 1,
    name: 'WindowServer',
    command: '/System/WindowServer',
    user: '_windowserver',
    cpuPercent: 12,
    memoryBytes: 300 * 1024 ** 2,
    memoryPercent: 2,
  },
  {
    pid: 100,
    parentPid: 1,
    name: 'ONIXLabs Studio',
    command: '/Applications/Studio',
    user: 'me',
    cpuPercent: 4.25,
    memoryBytes: 500 * 1024 ** 2,
    memoryPercent: 3,
    studio: 'main',
    threads: 34,
    startedAt: Date.parse('2026-11-14T10:00:00Z') - 403_000,
    location: '/Applications/ONIXLabs Studio.app/Contents/MacOS',
  },
  {
    pid: 200,
    parentPid: 100,
    name: 'zsh',
    command: '/bin/zsh -l',
    user: 'me',
    cpuPercent: 0.1,
    memoryBytes: 4 * 1024 ** 2,
    memoryPercent: 0.1,
    studio: 'child',
  },
  {
    pid: 400,
    parentPid: 1,
    name: 'Finder',
    command: '/System/Finder',
    user: 'me',
    cpuPercent: 0,
    memoryBytes: 90 * 1024 ** 2,
    memoryPercent: 0.5,
  },
];

/**
 * Builds a snapshot of the test processes, taken at 10:00 as the user `me`.
 * @param processes The processes listed.
 * @returns Returns the snapshot.
 */
function snapshot(processes: readonly ProcessSample[] = PROCESSES): ProcessesSnapshot {
  return { timestamp: '2026-11-14T10:00:00Z', total: 512, processes, user: 'me' };
}

describe('ProcessesTab', () => {
  let fixture: ComponentFixture<ProcessesTab>;
  let host: HTMLElement;
  let listing: SystemMonitorProcesses;
  let iconsAsked: string[];

  /**
   * Gets the names in the list's rows, top to bottom.
   * @returns Returns the names.
   */
  function names(): string[] {
    return Array.from(host.querySelectorAll('tbody tr .processes__name-text')).map(
      (cell: Element): string => cell.textContent?.trim() ?? '',
    );
  }

  /**
   * Finds a button by its visible label.
   * @param label The label.
   * @returns Returns the button.
   */
  function button(label: string): HTMLButtonElement {
    const match: HTMLButtonElement | undefined = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button'),
    ).find((element: HTMLButtonElement): boolean => element.textContent?.trim() === label);
    if (match === undefined) {
      throw new Error(`No button labelled "${label}"`);
    }
    return match;
  }

  /**
   * Settles the fixture after a change.
   */
  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    iconsAsked = [];
    await TestBed.configureTestingModule({
      imports: [ProcessesTab],
      providers: [
        SystemMonitorProcesses,
        SystemMonitorReadings,
        {
          provide: SystemMonitorMetrics,
          useValue: {
            processIcon: (location: string): Promise<string | null> => {
              iconsAsked.push(location);
              return Promise.resolve('data:image/png;base64,AAAA');
            },
          },
        },
      ],
    }).compileComponents();
    listing = TestBed.inject(SystemMonitorProcesses);
    fixture = TestBed.createComponent(ProcessesTab);
    host = fixture.nativeElement as HTMLElement;
    await settle();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('saysItIsListing_untilTheFirstSnapshotArrives', () => {
    expect(host.textContent).toContain('Listing processes…');
  });

  it('listsTheProcesses_busiestFirst_withTheirReadings', async () => {
    listing.accept(snapshot());
    await settle();

    expect(names()).toEqual(['WindowServer', 'ONIXLabs Studio', 'zsh', 'Finder']);
    // Running and listed, then the listed processes by owner: three are the user's, one the system's,
    // two Studio's.
    expect(
      Array.from(host.querySelectorAll('[aria-label="Summary"] li')).map(
        (item: Element): string =>
          `${item.querySelector('.view-summary__label')?.textContent?.trim()} ${item.querySelector('.view-summary__value')?.textContent?.trim()}`,
      ),
    ).toEqual(['Running 512', 'Listed 4', 'User 3', 'System 1', 'Studio 2']);
    expect(host.textContent).toContain('Started by Studio');
    // A small share keeps its decimal, so idle processes stay distinguishable.
    expect(host.textContent).toContain('4.3%');
    expect(host.textContent).toContain('6m 43s');
    expect(host.textContent).toContain('34');
    expect(host.querySelectorAll('tbody tr app-system-monitor-sparkline').length).toBeGreaterThan(
      0,
    );
  });

  it('showsTheAppsOwnIcon_whereItHasOne', async () => {
    listing.accept(snapshot());
    await settle();
    await settle();

    expect(iconsAsked).toEqual(['/Applications/ONIXLabs Studio.app/Contents/MacOS']);
    expect(host.querySelectorAll('img.processes__app-icon')).toHaveLength(1);
  });

  it('narrowsToTheUsersOwn_theSystems_andStudios', async () => {
    listing.accept(snapshot());
    await settle();

    button('User Processes').click();
    await settle();
    expect(names()).toEqual(['ONIXLabs Studio', 'zsh', 'Finder']);

    button('System Processes').click();
    await settle();
    expect(names()).toEqual(['WindowServer']);

    button('Studio').click();
    await settle();
    expect(names()).toEqual(['ONIXLabs Studio', 'zsh']);
  });

  it('narrowsToThoseUsingTheGpu_onceTheGpuIsReadPerProcess', async () => {
    listing.accept(snapshot());
    await settle();
    expect(button('GPU Active').disabled).toBe(true);

    listing.acceptGpu({ timestamp: 't', engines: [], processes: [{ pid: 300, gpuPercent: 2 }] });
    listing.accept(snapshot());
    await settle();
    button('GPU Active').click();
    await settle();

    expect(names()).toEqual(['WindowServer']);
  });

  it('pagesTheList', async () => {
    const many: ProcessSample[] = Array.from(
      { length: 60 },
      (_: unknown, index: number): ProcessSample => ({
        ...PROCESSES[3],
        pid: 1000 + index,
        name: `worker-${index}`,
        cpuPercent: 60 - index,
      }),
    );
    listing.accept(snapshot(many));
    await settle();

    expect(names()).toHaveLength(50);
    host.querySelector<HTMLButtonElement>('[aria-label="Page 2"]')?.click();
    await settle();

    expect(names()).toEqual(many.slice(50).map((process: ProcessSample): string => process.name));
  });
});
