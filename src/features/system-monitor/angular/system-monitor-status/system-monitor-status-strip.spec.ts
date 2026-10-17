import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  SystemMonitorSummary,
  SystemMonitorView,
} from '../system-monitor-view/system-monitor-view';
import { SystemMonitorStatusStrip } from './system-monitor-status-strip';

/**
 * Reads the rendered segment texts from one of the strip's two groups.
 * @param fixture The mounted status-strip fixture.
 * @param group The group to read: 0 for the leading group, 1 for the trailing one.
 * @returns Returns the segment texts in render order.
 */
function segmentsOf(fixture: ComponentFixture<SystemMonitorStatusStrip>, group: number): string[] {
  const host: HTMLElement = fixture.nativeElement as HTMLElement;
  const groups: NodeListOf<Element> = host.querySelectorAll('.status-strip-segments__group');
  return [...(groups.item(group)?.querySelectorAll('.status-strip-segment') ?? [])].map(
    (element: Element): string => (element.textContent ?? '').trim(),
  );
}

describe('SystemMonitorStatusStrip (#882)', () => {
  let fixture: ComponentFixture<SystemMonitorStatusStrip>;
  let summary: WritableSignal<SystemMonitorSummary>;

  beforeEach(() => {
    summary = signal<SystemMonitorSummary>({
      session: 'Current session',
      records: 1240,
      shown: 1240,
      errors: 0,
      warnings: 0,
      selected: 0,
      appCpu: '4%',
      appMemory: '612.0 MB (4%)',
    });
    TestBed.configureTestingModule({
      providers: [{ provide: SystemMonitorView, useValue: { summary } }],
    });
    fixture = TestBed.createComponent(SystemMonitorStatusStrip);
  });

  it('namesTheSession_thenTheRecordsAndStudiosOwnUse', () => {
    fixture.detectChanges();

    expect(segmentsOf(fixture, 0)).toEqual(['Current session']);
    expect(segmentsOf(fixture, 1)).toEqual([
      '1,240 records',
      'Studio CPU 4%',
      'Studio memory 612.0 MB (4%)',
    ]);
  });

  it('saysWhatTheFiltersShow_andCountsErrorsWarningsAndTheSelection', () => {
    summary.set({ ...summary(), shown: 320, errors: 12, warnings: 1, selected: 3 });
    fixture.detectChanges();

    expect(segmentsOf(fixture, 1)).toEqual([
      'Showing 320 of 1,240 records',
      '12 errors',
      '1 warning',
      '3 selected',
      'Studio CPU 4%',
      'Studio memory 612.0 MB (4%)',
    ]);
  });

  it('leavesOutStudiosUse_beforeItIsRead', () => {
    summary.set({ ...summary(), appCpu: null, appMemory: null });
    fixture.detectChanges();

    expect(segmentsOf(fixture, 1)).toEqual(['1,240 records']);
  });
});
