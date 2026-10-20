import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { SignatureView } from '@shared/angular/services/autocomplete/signature-content';
import { SignatureCard } from './signature-card';

/**
 * Builds a view.
 * @param extra Members to override.
 * @returns Returns the view.
 */
function view(extra: Partial<SignatureView> = {}): SignatureView {
  return {
    runs: [
      { text: 'add(a, ', active: false },
      { text: 'b', active: true },
      { text: ')', active: false },
    ],
    overload: null,
    sections: [],
    ...extra,
  };
}

describe('SignatureCard (#1021)', () => {
  let fixture: ComponentFixture<SignatureCard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SignatureCard] }).compileComponents();
    fixture = TestBed.createComponent(SignatureCard);
  });

  /**
   * Shows a view and renders it.
   * @param value The view.
   */
  async function show(value: SignatureView): Promise<void> {
    fixture.componentRef.setInput('view', value);
    await fixture.whenStable();
  }

  it('showsTheSignature_withTheActiveParameterHighlighted', async () => {
    await show(view());
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.signature-card__signature')?.textContent?.trim()).toBe(
      'add(a, b)',
    );
    expect(element.querySelector('.signature-card__parameter')?.textContent).toBe('b');
    expect(element.querySelector('.signature-card__overloads')).toBeNull();
    expect(element.querySelector('.signature-card__body')).toBeNull();
  });

  it('saysWhichOverloadShows_andStepsThroughThem', async () => {
    const steps: string[] = [];
    fixture.componentInstance.previous.subscribe((): void => void steps.push('previous'));
    fixture.componentInstance.next.subscribe((): void => void steps.push('next'));
    await show(view({ overload: { index: 1, count: 3 } }));
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.signature-card__count')?.textContent?.trim()).toBe('2/3');
    const buttons: HTMLButtonElement[] = Array.from(element.querySelectorAll('button'));
    buttons[0].click();
    buttons[1].click();

    expect(steps).toEqual(['previous', 'next']);
  });

  it('showsTheDocumentation_asMarkdown', async () => {
    await show(view({ sections: ['The **b**.', 'Adds.'] }));

    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-markdown-renderer'),
    ).toHaveLength(2);
  });

  it('aPressOnTheCard_neverTakesTheEditorsFocus', async () => {
    await show(view());
    const press: MouseEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });

    (fixture.nativeElement as HTMLElement).dispatchEvent(press);

    expect(press.defaultPrevented).toBe(true);
  });
});
