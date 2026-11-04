import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TextField, TextFieldVariant } from './text-field';

describe('TextField', () => {
  let component: TextField;
  let fixture: ComponentFixture<TextField>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TextField],
    }).compileComponents();

    fixture = TestBed.createComponent(TextField);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('value_whenInputTyped_updatesTheModelOnEachKeystroke', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const input: HTMLInputElement | null = element.querySelector<HTMLInputElement>('input');
    if (input !== null) {
      input.value = 'JetBrains Mono';
      input.dispatchEvent(new Event('input'));
    }

    expect(component.value()).toBe('JetBrains Mono');
  });

  it('enter_andEscape_areOfferedAsOutputs_ratherThanLeftToTheCaller', () => {
    const control: HTMLInputElement = (fixture.nativeElement as HTMLElement).querySelector(
      'input',
    )!;
    let committed: number = 0;
    let abandoned: number = 0;
    component.enter.subscribe((): void => void (committed += 1));
    component.escape.subscribe((): void => void (abandoned += 1));

    control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(committed).toBe(1);
    expect(abandoned).toBe(1);
  });

  it('variant_none_dropsTheFieldsOwnBoxSoItFillsWhatFramesIt', () => {
    fixture.componentRef.setInput('variant', 'none');
    fixture.detectChanges();

    // A grid cell already draws the box; a second one inside it reads as a form rather than a grid.
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.classList.contains('text-field--seamless')).toBe(true);
  });

  it('search_wearsItsGlyph_andNamesItself', () => {
    fixture.componentRef.setInput('kind', 'search');
    fixture.componentRef.setInput('ariaLabel', 'Filter the tree');
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.text-field__glyph')).not.toBeNull();
    expect(host.querySelector('input')?.getAttribute('aria-label')).toBe('Filter the tree');
  });

  it('floating_rendersALabelTiedToTheControl', () => {
    fixture.componentRef.setInput('variant', 'floating');
    fixture.componentRef.setInput('label', 'Summary');
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const label: HTMLLabelElement = host.querySelector<HTMLLabelElement>('label')!;
    expect(label.textContent?.trim()).toBe('Summary');
    expect(label.htmlFor).not.toBe('');
    expect(label.htmlFor).toBe(host.querySelector('input')!.id);
  });

  it('floating_withNoPlaceholder_stillCarriesOne', () => {
    fixture.componentRef.setInput('variant', 'floating');
    fixture.detectChanges();

    // The stylesheet tells an empty field from a filled one by whether the placeholder is showing.
    const input: HTMLInputElement = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    expect(input.getAttribute('placeholder')).toBe(' ');
  });

  it('floating_withAPlaceholder_keepsIt', () => {
    fixture.componentRef.setInput('variant', 'floating');
    fixture.componentRef.setInput('placeholder', 'Click to expand');
    fixture.detectChanges();

    const input: HTMLInputElement = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    expect(input.getAttribute('placeholder')).toBe('Click to expand');
  });

  it.each(['outline', 'none', 'inline'] as const)(
    'variant_%s_rendersNoFloatingLabel_andKeepsItsPlaceholder',
    (variant: TextFieldVariant) => {
      fixture.componentRef.setInput('variant', variant);
      fixture.componentRef.setInput('label', 'Summary');
      fixture.componentRef.setInput('placeholder', 'Click to expand');
      fixture.detectChanges();

      const host: HTMLElement = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('label')).toBeNull();
      expect(host.querySelector('input')?.getAttribute('placeholder')).toBe('Click to expand');
    },
  );
});
