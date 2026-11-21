import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OperationStrip } from './operation-strip';

/**
 * Gets a button by its visible label.
 * @param host The rendered strip.
 * @param name The label.
 * @returns Returns the button, or undefined when the strip does not show it.
 */
function namedButton(host: HTMLElement, name: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (button: HTMLButtonElement): boolean => button.textContent?.trim() === name,
  );
}

describe('OperationStrip', () => {
  let fixture: ComponentFixture<OperationStrip>;
  let host: HTMLElement;
  let pressed: string[];

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [OperationStrip] });
    fixture = TestBed.createComponent(OperationStrip);
    fixture.componentRef.setInput('title', 'Merging topic into main');
    fixture.componentRef.setInput('progress', '2 of 5 files resolved');
    fixture.componentRef.setInput('message', 'Resolve each one, mark it resolved, then continue.');
    pressed = [];
    fixture.componentInstance.continueClick.subscribe((): void => {
      pressed.push('continue');
    });
    fixture.componentInstance.skipClick.subscribe((): void => {
      pressed.push('skip');
    });
    fixture.componentInstance.abortClick.subscribe((): void => {
      pressed.push('abort');
    });
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  });

  it('saysWhatIsHappening_andHowFarThroughTheUserIs', () => {
    expect(host.querySelector('[data-testid="operation-strip-title"]')?.textContent).toBe(
      'Merging topic into main',
    );
    expect(
      host.querySelector('[data-testid="operation-strip-progress"]')?.textContent?.trim(),
    ).toBe('2 of 5 files resolved');
  });

  it('isAStatus_namedByItsTitle_andDescribedByWhatToDoNext', () => {
    expect(host.getAttribute('role')).toBe('status');
    expect(host.getAttribute('aria-label')).toBe('Merging topic into main');
    expect(host.getAttribute('aria-description')).toBe(
      'Resolve each one, mark it resolved, then continue.',
    );
  });

  it('leavesOutTheCount_whenThereIsNone', () => {
    fixture.componentRef.setInput('progress', null);
    fixture.detectChanges();

    expect(host.querySelector('[data-testid="operation-strip-progress"]')).toBeNull();
  });

  it('holdsContinue_untilNothingIsConflicted', () => {
    expect(namedButton(host, 'Continue')?.disabled).toBe(true);

    fixture.componentRef.setInput('canContinue', true);
    fixture.detectChanges();

    expect(namedButton(host, 'Continue')?.disabled).toBe(false);
  });

  it('offersSkip_onlyWhenAsked', () => {
    expect(namedButton(host, 'Skip')).toBeUndefined();

    fixture.componentRef.setInput('canSkip', true);
    fixture.detectChanges();

    expect(namedButton(host, 'Skip')).toBeDefined();
  });

  it('reportsEachButton', () => {
    fixture.componentRef.setInput('canContinue', true);
    fixture.componentRef.setInput('canSkip', true);
    fixture.detectChanges();

    namedButton(host, 'Continue')?.click();
    namedButton(host, 'Skip')?.click();
    namedButton(host, 'Abort')?.click();

    expect(pressed).toEqual(['continue', 'skip', 'abort']);
  });

  it('putsTheButtonsInTheirSignedOffTones', () => {
    fixture.componentRef.setInput('canSkip', true);
    fixture.detectChanges();
    const tones: (string | null)[] = [
      'operation-continue',
      'operation-skip',
      'operation-abort',
    ].map(
      (id: string): string | null => host.querySelector(`[data-testid="${id}"]`)?.className ?? null,
    );

    expect(tones[0]).toContain('solid');
    expect(tones[1]).toContain('warning');
    expect(tones[2]).toContain('danger');
  });
});
