import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SecuritySettingsSection } from './security-settings';

describe('SecuritySettingsSection', () => {
  let component: SecuritySettingsSection;
  let fixture: ComponentFixture<SecuritySettingsSection>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SecuritySettingsSection],
    }).compileComponents();

    fixture = TestBed.createComponent(SecuritySettingsSection);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenShown_rendersTheImagePolicyRow', () => {
    expect(host.querySelectorAll('app-setting-row').length).toBe(1);
  });

  it('imagePolicy_whenOutsideElectron_disablesTheDropdown', () => {
    const select: HTMLSelectElement | null = host.querySelector<HTMLSelectElement>('select');

    expect(select?.disabled).toBe(true);
  });
});
