import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { LogRecord } from '@shared/api/log-channels';
import { LogDetailsCard } from './log-details-card';

describe('LogDetailsCard', () => {
  let fixture: ComponentFixture<LogDetailsCard>;
  let host: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(LogDetailsCard);
    host = fixture.nativeElement as HTMLElement;
  });

  it('asksForARecord_untilOneIsChosen', () => {
    fixture.detectChanges();

    expect(host.textContent).toContain('Choose a record to see its details.');
  });

  it('describesTheChosenRecord_withItsWholeMessage', () => {
    const record: LogRecord = {
      id: 1,
      sessionId: 's',
      timestamp: new Date(2026, 10, 14, 0, 26, 42, 137).toISOString(),
      severity: 'warning',
      origin: 'renderer',
      window: 'window-2',
      source: 'Plugins',
      message: 'A long message\nover two lines',
    };
    fixture.componentRef.setInput('record', record);
    fixture.componentRef.setInput('session', 'Current session');
    fixture.detectChanges();

    const details: string = host.querySelector('[data-testid="log-details"]')?.textContent ?? '';
    expect(details).toContain('00:26:42.137');
    expect(details).toContain('WARNING');
    expect(details).toContain('Plugins');
    expect(details).toContain('Renderer · window-2');
    expect(details).toContain('Current session');
    expect(host.querySelector('.log-details__message')?.textContent).toBe(
      'A long message\nover two lines',
    );
    expect(host.querySelector('app-chip')?.className).toContain('chip--warning');
  });
});
