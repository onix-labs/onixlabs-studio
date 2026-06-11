import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LanguageSelect } from './language-select';

describe('LanguageSelect', () => {
  let component: LanguageSelect;
  let fixture: ComponentFixture<LanguageSelect>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LanguageSelect],
    }).compileComponents();

    fixture = TestBed.createComponent(LanguageSelect);
    fixture.componentRef.setInput('languages', ['typescript', 'javascript', 'python']);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenLanguagesSet_rendersAnOptionPerLanguage', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('option').length).toBe(3);
  });

  it('value_whenOptionsSelected_collectsThemIntoTheModel', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const select: HTMLSelectElement | null = element.querySelector<HTMLSelectElement>('select');
    if (select !== null) {
      select.options[0].selected = true;
      select.options[2].selected = true;
      select.dispatchEvent(new Event('change'));
    }

    expect(component.value()).toEqual(['typescript', 'python']);
  });
});
