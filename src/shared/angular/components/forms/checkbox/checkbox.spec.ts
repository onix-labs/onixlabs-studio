import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Checkbox } from './checkbox';

describe('Checkbox', () => {
  let component: Checkbox;
  let fixture: ComponentFixture<Checkbox>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Checkbox],
    }).compileComponents();

    fixture = TestBed.createComponent(Checkbox);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('checked_whenCheckboxToggled_updatesTheModel', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const input: HTMLInputElement | null = element.querySelector<HTMLInputElement>('input');
    if (input !== null) {
      input.checked = true;
      input.dispatchEvent(new Event('change'));
    }

    expect(component.checked()).toBe(true);
  });

  it('render_whenDisabled_disablesTheCheckbox', () => {
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector<HTMLInputElement>('input')?.disabled).toBe(true);
  });

  it('render_whenIndeterminate_setsTheMixedStateOnTheNativeCheckbox', () => {
    fixture.componentRef.setInput('indeterminate', true);
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector<HTMLInputElement>('input')?.indeterminate).toBe(true);

    fixture.componentRef.setInput('indeterminate', false);
    fixture.detectChanges();
    expect(element.querySelector<HTMLInputElement>('input')?.indeterminate).toBe(false);
  });
});
