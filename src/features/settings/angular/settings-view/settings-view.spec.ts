import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Theme } from '@shared/angular/services/theme/theme';
import { SettingsView } from './settings-view';

describe('SettingsView', () => {
  let component: SettingsView;
  let fixture: ComponentFixture<SettingsView>;
  let theme: Theme;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [SettingsView],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsView);
    component = fixture.componentInstance;
    theme = TestBed.inject(Theme);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /**
   * Finds the dropdown whose options include the given value, so a specific appearance control (theme
   * or accent) can be targeted without depending on row order.
   * @param element The rendered settings view.
   * @param value The option value the target dropdown offers.
   * @returns Returns the matching select, or null.
   */
  function dropdownWithOption(element: HTMLElement, value: string): HTMLSelectElement | null {
    return (
      Array.from(element.querySelectorAll<HTMLSelectElement>('select')).find(
        (select: HTMLSelectElement): boolean =>
          Array.from(select.options).some(
            (option: HTMLOptionElement): boolean => option.value === value,
          ),
      ) ?? null
    );
  }

  it('selectMode_whenAModeOptionPicked_setsThatModeOnTheTheme', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const select: HTMLSelectElement | null = dropdownWithOption(element, 'dark');

    select!.value = 'dark';
    select!.dispatchEvent(new Event('change'));

    expect(theme.mode()).toBe('dark');
  });

  it('selectAccent_whenAnAccentPicked_setsThatAccentOnTheTheme', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const select: HTMLSelectElement | null = dropdownWithOption(element, 'green');

    select!.value = 'green';
    select!.dispatchEvent(new Event('change'));

    expect(theme.accent()).toBe('green');
  });

  it('render_whenAccentIsSelected_reflectsItInTheAccentDropdown', async () => {
    theme.setAccent('pink');
    fixture.detectChanges();
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const select: HTMLSelectElement | null = dropdownWithOption(element, 'pink');

    expect(select?.value).toBe('pink');
  });
});
