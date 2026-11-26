import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { LogRecord } from '@shared/api/log-channels';
import { LogContextCard } from './log-context-card';

/**
 * A record with an object logged with its message.
 */
const RECORD: LogRecord = {
  id: 7,
  sessionId: 's',
  timestamp: 't',
  severity: 'info',
  origin: 'main',
  source: 'WindowStateStore',
  message: 'restored state',
  details: ['{"maximized":true}'],
};

describe('LogContextCard', () => {
  let fixture: ComponentFixture<LogContextCard>;
  let host: HTMLElement;
  let writeText: Mock;

  /**
   * Finds one of the card's buttons by its label.
   * @param label The label.
   * @returns Returns the button.
   */
  function button(label: string): HTMLButtonElement {
    const found: HTMLButtonElement | undefined = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button'),
    ).find(
      (each: HTMLButtonElement): boolean =>
        each.textContent?.trim() === label || each.getAttribute('aria-label') === label,
    );
    if (found === undefined) {
      throw new Error(`No button "${label}"`);
    }
    return found;
  }

  /**
   * Settles the fixture after a change.
   */
  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fixture = TestBed.createComponent(LogContextCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('showsTheContext_andSwitchesToTheRawRecord_withItsToggles', async () => {
    fixture.componentRef.setInput('record', RECORD);
    await settle();

    expect(button('Context').getAttribute('aria-pressed')).toBe('true');
    expect(button('Raw').getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelector('[data-testid="log-context-code"]')?.textContent).toContain(
      '"maximized": true',
    );

    button('Raw').click();
    await settle();

    expect(button('Raw').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[data-testid="log-context-code"]')?.textContent).toContain(
      '"sessionId": "s"',
    );
  });

  it('numbersEachLine_andColoursTheJson', async () => {
    fixture.componentRef.setInput('record', RECORD);
    await settle();

    const numbers: string[] = Array.from(host.querySelectorAll('.log-context__number')).map(
      (number: Element): string => number.textContent ?? '',
    );
    expect(numbers).toEqual(['1', '2', '3']);
    expect(host.querySelector('.log-context__token--key')?.textContent).toBe('"maximized"');
    expect(host.querySelector('.log-context__token--literal')?.textContent).toBe('true');
  });

  it('copiesWhatItShows', async () => {
    fixture.componentRef.setInput('record', RECORD);
    await settle();

    button('Copy').click();
    await settle();

    expect(writeText).toHaveBeenCalledWith('{\n  "maximized": true\n}');
  });

  it('saysSo_whenNothingWasLoggedWithTheMessage_orNoRecordIsChosen', async () => {
    await settle();
    expect(host.textContent).toContain('Choose a record to see its context.');

    fixture.componentRef.setInput('record', { ...RECORD, details: undefined });
    await settle();
    expect(host.textContent).toContain('Nothing was logged with this message.');
    expect((): HTMLButtonElement => button('Copy')).toThrow();
  });
});
