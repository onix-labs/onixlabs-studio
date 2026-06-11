import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Dropdown, DropdownOption } from './dropdown';

const OPTIONS: readonly DropdownOption[] = [
  { value: 'code', label: 'Code' },
  { value: 'markdown', label: 'Markdown' },
];

describe('Dropdown', () => {
  let component: Dropdown;
  let fixture: ComponentFixture<Dropdown>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Dropdown],
    }).compileComponents();

    fixture = TestBed.createComponent(Dropdown);
    fixture.componentRef.setInput('options', OPTIONS);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenOptionsSet_rendersAnOptionPerEntry', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('option').length).toBe(2);
  });

  it('value_whenSelectionChanged_updatesTheModel', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const select: HTMLSelectElement | null = element.querySelector<HTMLSelectElement>('select');
    if (select !== null) {
      select.value = 'markdown';
      select.dispatchEvent(new Event('change'));
    }

    expect(component.value()).toBe('markdown');
  });
});
