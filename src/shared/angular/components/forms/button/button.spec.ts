import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';

import { Button } from './button';

describe('Button', () => {
  let fixture: ComponentFixture<Button>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Button] }).compileComponents();
    fixture = TestBed.createComponent(Button);
    host = fixture.nativeElement as HTMLElement;
  });

  /**
   * Applies inputs and renders.
   * @param inputs The inputs to set.
   */
  function render(inputs: Record<string, unknown> = {}): void {
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
  }

  it('should create', () => {
    render();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('variant_whenUnstated_isOutline_theStandardButton', () => {
    render();

    expect(host.classList.contains('button--outline')).toBe(true);
  });

  it('variant_whenStated_marksTheHost_soTheStylesheetDrawsIt', () => {
    render({ variant: 'solid' });
    expect(host.classList.contains('button--solid')).toBe(true);

    render({ variant: 'none' });
    expect(host.classList.contains('button--none')).toBe(true);
    expect(host.classList.contains('button--solid')).toBe(false);
  });

  it('label_whenGiven_isRendered_andTheButtonIsNotIconOnly', () => {
    render({ label: 'Clear', icon: Icon.TRASH });

    expect(host.querySelector('.button__label')?.textContent).toContain('Clear');
    expect(host.querySelector('.button__icon')).not.toBeNull();
    expect(host.classList.contains('button--icon-only')).toBe(false);
  });

  it('iconOnly_isDerivedFromTheContent_notFromAFlag', () => {
    render({ icon: Icon.TRASH, ariaLabel: 'Remove' });

    expect(host.classList.contains('button--icon-only')).toBe(true);
    expect(host.querySelector('.button__label')).toBeNull();
    expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('Remove');
  });

  it('iconOnly_whenThereIsNoGlyphAtAll_isFalse', () => {
    // A button with neither icon nor label is empty, not square: squaring it would hide the fact.
    render();

    expect(host.classList.contains('button--icon-only')).toBe(false);
  });

  it('type_whenUnstated_isAPlainButton_soAFormIsNotSubmittedByAccident', () => {
    render();

    expect(host.querySelector('button')?.getAttribute('type')).toBe('button');
  });

  it('disabled_whenSet_disablesTheUnderlyingButton', () => {
    render({ label: 'Save', disabled: true });

    expect(host.querySelector('button')!.disabled).toBe(true);
  });

  it('tooltip_whenGiven_titlesTheButton', () => {
    render({ icon: Icon.TRASH, tooltip: 'Remove item' });

    expect(host.querySelector('button')?.getAttribute('title')).toBe('Remove item');
  });
});
