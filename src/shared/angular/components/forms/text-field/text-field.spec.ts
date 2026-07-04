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
});
