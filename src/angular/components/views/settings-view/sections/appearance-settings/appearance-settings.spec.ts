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

  it('render_whenShown_rendersTheAccentSwatchesFromTheRegistry', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('.swatch').length).toBe(8);
  });

  it('render_whenShown_rendersTheThemeRibbonAndModernUiSegments', () => {
    // Theme (3) + ribbon alignment (3) + modern UI features (3) = 9 segmented options.
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('.segmented__option').length).toBe(9);
  });

  it('render_whenShown_rendersTheBespokeHardwareAccelerationToggle', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('app-toggle')).toBeTruthy();
  });

  it('render_whenNoChangePending_hidesTheRestartNotice', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.restart-notice')).toBeNull();
  });
});
