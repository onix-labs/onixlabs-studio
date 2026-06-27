import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ButtonGroup, ButtonGroupOption } from './button-group';
import { Icon } from '../../../icons/icon';

const OPTIONS: readonly ButtonGroupOption[] = [
  { value: 'left', label: 'Left', icon: Icon.ALIGN_LEFT },
  { value: 'center', label: 'Center', icon: Icon.ALIGN_CENTER },
  { value: 'right', label: 'Right', icon: Icon.ALIGN_RIGHT },
];

describe('ButtonGroup', () => {
  let component: ButtonGroup;
  let fixture: ComponentFixture<ButtonGroup>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ButtonGroup],
    }).compileComponents();

    fixture = TestBed.createComponent(ButtonGroup);
    fixture.componentRef.setInput('options', OPTIONS);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenOptionsSet_rendersAnOptionPerEntry', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('.segmented__option').length).toBe(3);
  });

  it('render_whenOptionHasIcon_rendersTheIcon', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.segmented__option app-icon')).toBeTruthy();
  });

  it('render_whenValueSet_marksTheSelectedOption', async () => {
    fixture.componentRef.setInput('value', 'center');
    fixture.detectChanges();
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const selected: Element | null = element.querySelector('.segmented__option--selected');
    expect(selected?.textContent).toContain('Center');
    expect(selected?.getAttribute('aria-checked')).toBe('true');
  });

  it('ariaLabel_whenSet_namesTheGroup', async () => {
    fixture.componentRef.setInput('ariaLabel', 'Alignment');
    fixture.detectChanges();
    await fixture.whenStable();

    const group: Element | null = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="radiogroup"]',
    );
    expect(group?.getAttribute('aria-label')).toBe('Alignment');
  });

  it('valueChange_whenOptionClicked_emitsThePickedValue', () => {
    let emitted: string | undefined;
    component.valueChange.subscribe((value: string): void => {
      emitted = value;
    });

    const buttons: NodeListOf<HTMLButtonElement> = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll<HTMLButtonElement>('.segmented__option');
    buttons[2].click();

    expect(emitted).toBe('right');
  });
});
