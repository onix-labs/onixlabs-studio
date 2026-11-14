import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProcessSample } from '@shared/api/system-monitor-channels';
import { SystemMonitorProcesses } from '../../readings/system-monitor-processes';
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

describe('ProcessesTab', () => {
  let fixture: ComponentFixture<ProcessesTab>;
  let host: HTMLElement;
  let listing: SystemMonitorProcesses;

  /**
   * Gets the names in the list's rows, top to bottom.
   * @returns Returns the names.
   */
  function names(): string[] {
    return Array.from(host.querySelectorAll('tbody tr td:first-child')).map(
      (cell: Element): string => cell.querySelector('span')?.textContent?.trim() ?? '',
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
    await TestBed.configureTestingModule({
      imports: [ProcessesTab],
      providers: [SystemMonitorProcesses],
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

  it('listsTheProcesses_busiestFirst_markingStudiosOwn', async () => {
    listing.accept({ timestamp: 't', total: 512, processes: PROCESSES });
    await settle();

    expect(names()).toEqual(['WindowServer', 'ONIXLabs Studio', 'zsh', 'Finder']);
    expect(host.textContent).toContain('Started by Studio');
    expect(host.textContent).toContain('4 of 512');
    // A small share keeps its decimal, so idle processes stay distinguishable.
    expect(host.textContent).toContain('4.3%');
  });

  it('narrowsToStudiosProcesses', async () => {
    listing.accept({ timestamp: 't', total: 512, processes: PROCESSES });
    await settle();

    button('Studio').click();
    await settle();

    expect(names()).toEqual(['ONIXLabs Studio', 'zsh']);
    expect(host.textContent).toContain('2 of 512');
  });

  it('choosingAProcess_showsItsDetailsAndGraphs_andClosingHidesThem', async () => {
    listing.accept({ timestamp: 't', total: 512, processes: PROCESSES });
    await settle();
    expect(host.querySelector('[data-testid="process-details"]')).toBeNull();

    host.querySelectorAll<HTMLTableRowElement>('tbody tr')[2].click();
    await settle();

    const details: HTMLElement | null = host.querySelector('[data-testid="process-details"]');
    expect(details?.textContent).toContain('zsh');
    expect(details?.textContent).toContain('/bin/zsh -l');
    expect(details?.textContent).toContain('100');
    expect(details?.querySelectorAll('app-metric-tile')).toHaveLength(2);

    // The process exiting keeps its details up, marked as no longer listed.
    listing.accept({
      timestamp: 't',
      total: 511,
      processes: PROCESSES.filter((process: ProcessSample): boolean => process.pid !== 200),
    });
    await settle();
    expect(host.querySelector('[data-testid="process-details"]')?.textContent).toContain(
      'Not listed',
    );

    host.querySelector<HTMLButtonElement>('[aria-label="Close details"]')?.click();
    await settle();
    expect(host.querySelector('[data-testid="process-details"]')).toBeNull();
  });
});
