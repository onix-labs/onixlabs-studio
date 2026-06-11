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

  it('render_whenShown_offersEveryThemeModeAndAccent', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('.segmented__option').length).toBe(3);
    expect(element.querySelectorAll('.swatch').length).toBe(8);
  });
});
