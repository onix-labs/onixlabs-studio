import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ApplicationSettings } from './application-settings';

describe('ApplicationSettings', () => {
  let component: ApplicationSettings;
  let fixture: ComponentFixture<ApplicationSettings>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [ApplicationSettings],
    }).compileComponents();

    fixture = TestBed.createComponent(ApplicationSettings);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenShown_rendersASettingRowPerControl', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('app-setting-row').length).toBe(2);
  });
});
