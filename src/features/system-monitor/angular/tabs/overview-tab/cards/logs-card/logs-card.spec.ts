import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { LogRecord } from '@shared/api/log-channels';
import { LogsCard } from './logs-card';

/**
 * Builds a record.
 * @param id The record's id.
 * @param message Its message.
 * @returns Returns the record.
 */
function record(id: number, message: string): LogRecord {
  return {
    id,
    sessionId: 's',
    timestamp: '2026-11-14T00:26:42.000Z',
    severity: 'info',
    origin: 'main',
    source: 'test',
    message,
  };
}

describe('LogsCard', () => {
  let fixture: ComponentFixture<LogsCard>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [LogsCard] }).compileComponents();
    fixture = TestBed.createComponent(LogsCard);
    host = fixture.nativeElement as HTMLElement;
  });

  it('countsBySeverity_andListsTheLatestRecords', async () => {
    fixture.componentRef.setInput('logs', {
      info: 187,
      warnings: 2,
      errors: 0,
      recent: [record(2, 'Studio ready'), record(1, 'Seeded the registry')],
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.querySelector('[title="Informational records"]')?.textContent).toContain('187');
    expect(host.querySelector('[title="Warnings"]')?.textContent).toContain('2');
    const rows: NodeListOf<HTMLTableRowElement> = host.querySelectorAll(
      '[data-testid="logs-card-records"] tbody tr',
    );
    expect(rows[0].textContent).toContain('Studio ready');
    expect(rows[0].textContent).toContain('INFO');
  });

  it('saysSo_whenThereAreNoRecords', async () => {
    fixture.componentRef.setInput('logs', { info: 0, warnings: 0, errors: 0, recent: [] });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.textContent).toContain('No records yet.');
  });
});
