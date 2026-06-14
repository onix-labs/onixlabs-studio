import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Settings } from '../../../../../services/settings/settings';
import { AiSettingsSection } from './ai-settings';

describe('AiSettingsSection', () => {
  let component: AiSettingsSection;
  let fixture: ComponentFixture<AiSettingsSection>;
  let host: HTMLElement;

  /**
   * Finds the form control inside the setting row with the given label.
   * @param label The row label.
   * @returns Returns the row's select element.
   */
  function rowSelect(label: string): HTMLSelectElement {
    const row: Element | undefined = Array.from(host.querySelectorAll('app-setting-row')).find(
      (element: Element): boolean =>
        element.querySelector('.setting-row__label')?.textContent?.trim() === label,
    );
    const select: HTMLSelectElement | null | undefined = row?.querySelector('select');
    if (select === null || select === undefined) {
      throw new Error(`No select in row "${label}"`);
    }
    return select;
  }

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [AiSettingsSection],
    }).compileComponents();

    fixture = TestBed.createComponent(AiSettingsSection);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('render_whenShown_rendersARowPerControl', () => {
    expect(host.querySelectorAll('app-setting-row').length).toBe(4);
  });

  it('posture_whenChanged_persistsToSettings', () => {
    const settings: Settings = TestBed.inject(Settings);
    const select: HTMLSelectElement = rowSelect('Permission posture');

    select.value = 'auto-all';
    select.dispatchEvent(new Event('change'));

    expect(settings.aiPermissionPosture()).toBe('auto-all');
  });

  it('tokenCap_whenChanged_persistsToSettings', () => {
    const settings: Settings = TestBed.inject(Settings);
    const row: Element | undefined = Array.from(host.querySelectorAll('app-setting-row')).find(
      (element: Element): boolean =>
        element.querySelector('.setting-row__label')?.textContent?.trim() ===
        'Per-request token cap',
    );
    const input: HTMLInputElement | null | undefined = row?.querySelector('input');
    if (input !== null && input !== undefined) {
      input.value = '8000';
      input.dispatchEvent(new Event('change'));
    }

    expect(settings.aiTokenCap()).toBe(8000);
  });

  it('auth_whenOutsideElectron_disablesTheVerifyButton', () => {
    const verify: HTMLButtonElement | undefined = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button: HTMLButtonElement): boolean => button.textContent?.trim() === 'Verify');

    expect(verify?.disabled).toBe(true);
  });
});
