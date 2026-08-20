import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TextField } from './text-field';

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
});
