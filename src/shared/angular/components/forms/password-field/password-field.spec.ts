import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PasswordField } from './password-field';

describe('PasswordField', () => {
  let component: PasswordField;
  let fixture: ComponentFixture<PasswordField>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PasswordField],
    }).compileComponents();

    fixture = TestBed.createComponent(PasswordField);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenShown_masksTheInput', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const input: HTMLInputElement | null = element.querySelector<HTMLInputElement>('input');

    expect(input?.type).toBe('password');
  });

  it('value_whenInput_updatesTheModel', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const input: HTMLInputElement | null = element.querySelector<HTMLInputElement>('input');
    if (input !== null) {
      input.value = 'sk-ant-secret';
      input.dispatchEvent(new Event('input'));
    }

    expect(component.value()).toBe('sk-ant-secret');
  });
});
