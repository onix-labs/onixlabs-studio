import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RibbonStripCheck } from './ribbon-strip-check';

describe('RibbonStripCheck', () => {
  let component: RibbonStripCheck;
  let fixture: ComponentFixture<RibbonStripCheck>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RibbonStripCheck],
    }).compileComponents();

    fixture = TestBed.createComponent(RibbonStripCheck);
    fixture.componentRef.setInput('label', 'Word Wrap');
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('toggled_whenCheckboxChanged_emitsTheNewState', () => {
    let emitted: boolean | undefined;
    component.toggled.subscribe((value: boolean): void => {
      emitted = value;
    });

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const input: HTMLInputElement | null = element.querySelector<HTMLInputElement>('input');
    if (input !== null) {
      input.checked = true;
      input.dispatchEvent(new Event('change'));
    }

    expect(emitted).toBe(true);
  });
});
