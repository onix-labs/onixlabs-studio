import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Theme } from '../../../services/theme/theme';
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

  it('selectMode_whenAModeOptionClicked_setsThatModeOnTheTheme', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const darkOption: HTMLButtonElement | null =
      Array.from(element.querySelectorAll<HTMLButtonElement>('.segmented__option')).find(
        (button: HTMLButtonElement): boolean => button.textContent?.includes('Dark') ?? false,
      ) ?? null;

    darkOption?.click();

    expect(theme.mode()).toBe('dark');
  });

  it('selectAccent_whenASwatchClicked_setsThatAccentOnTheTheme', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const greenSwatch: HTMLButtonElement | null = element.querySelector<HTMLButtonElement>(
      '.swatch[aria-label="green"]',
    );

    greenSwatch?.click();

    expect(theme.accent()).toBe('green');
  });

  it('render_whenAccentIsSelected_marksTheActiveSwatch', async () => {
    theme.setAccent('pink');
    fixture.detectChanges();
    await fixture.whenStable();

    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const pinkSwatch: HTMLButtonElement | null = element.querySelector<HTMLButtonElement>(
      '.swatch[aria-label="pink"]',
    );

    expect(pinkSwatch?.classList.contains('swatch--selected')).toBe(true);
    expect(pinkSwatch?.getAttribute('aria-checked')).toBe('true');
  });
});
