import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Radio } from './radio';

describe('Radio', () => {
  let component: Radio;
  let fixture: ComponentFixture<Radio>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Radio],
    }).compileComponents();

    fixture = TestBed.createComponent(Radio);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('checked_whenRadioSelected_updatesTheModel', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const input: HTMLInputElement | null = element.querySelector<HTMLInputElement>('input');
    if (input !== null) {
      input.checked = true;
      input.dispatchEvent(new Event('change'));
    }

    expect(component.checked()).toBe(true);
  });

  it('render_whenDisabled_disablesTheRadio', () => {
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector<HTMLInputElement>('input')?.disabled).toBe(true);
  });
});
