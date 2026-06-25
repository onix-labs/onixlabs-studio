import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AppearanceSettings } from './appearance-settings';

describe('AppearanceSettings', () => {
  let component: AppearanceSettings;
  let fixture: ComponentFixture<AppearanceSettings>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [AppearanceSettings],
    }).compileComponents();

    fixture = TestBed.createComponent(AppearanceSettings);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenShown_offersEveryThemeModeAccentAndAlignment', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const theme: Element = element.querySelector('[aria-label="Theme"]')!;
    const alignment: Element = element.querySelector('[aria-label="Ribbon alignment"]')!;
    expect(theme.querySelectorAll('.segmented__option').length).toBe(3);
    expect(alignment.querySelectorAll('.segmented__option').length).toBe(3);
    expect(element.querySelectorAll('.swatch').length).toBe(8);
  });

  it('render_whenShown_offersModernUiFeaturesAndHardwareAcceleration', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const modernUi: Element = element.querySelector('[aria-label="Modern UI features"]')!;
    expect(modernUi.querySelectorAll('.segmented__option').length).toBe(3);
    expect(element.querySelector('app-toggle')).toBeTruthy();
  });
});
