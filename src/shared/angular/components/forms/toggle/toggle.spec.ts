import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Toggle } from './toggle';

describe('Toggle', () => {
  let component: Toggle;
  let fixture: ComponentFixture<Toggle>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Toggle],
    }).compileComponents();

    fixture = TestBed.createComponent(Toggle);
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
});
