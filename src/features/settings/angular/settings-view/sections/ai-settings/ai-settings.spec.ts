import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { AiConnection } from '@shared/api/ai-types';
import { Settings } from '@shared/angular/services/settings/settings';
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

  /**
   * Gets the connection-list item elements.
   * @returns Returns the item elements.
   */
  function items(): HTMLElement[] {
    return Array.from(host.querySelectorAll<HTMLElement>('.ai-connections__item'));
  }

  /**
   * Selects which slice of the settings the section renders, then applies the change.
   * @param view The view to show.
   * @param providerId The company page to show when the view is `provider`.
   */
  function show(view: 'general' | 'security' | 'provider', providerId: string = ''): void {
    fixture.componentRef.setInput('view', view);
    fixture.componentRef.setInput('providerId', providerId);
    fixture.detectChanges();
  }

  /**
   * Finds the add-configuration button with the given label on a provider page.
   * @param label The button label (a method's button label, e.g. "Subscription").
   * @returns Returns the button, or undefined.
   */
  function addButton(label: string): HTMLButtonElement | undefined {
    return Array.from(host.querySelectorAll<HTMLButtonElement>('.ai-connections__add button')).find(
      (button: HTMLButtonElement): boolean => button.textContent?.trim() === label,
    );
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

  it('render_whenGeneralView_rendersARowPerGlobalControl', () => {
    // Auto-scroll, report-background-tasks, remote-control notifications, token cap, run timeout,
    // session lifetime, agent shell.
    expect(host.querySelectorAll('app-setting-row').length).toBe(7);
  });

  it('render_whenSecurityView_rendersThePermissionPostureRow', () => {
    show('security');
    expect(rowSelect('Permission posture')).toBeTruthy();
  });

  it('render_whenProviderView_rendersAnItemPerConfigurationOfThatCompany', () => {
    // The seeds carry two anthropic configurations: the Claude subscription and the API-key connection.
    show('provider', 'anthropic');
    expect(items().length).toBe(2);
    expect(addButton('Subscription')).toBeTruthy();
    expect(addButton('API Key')).toBeTruthy();
  });

  it('render_whenProviderViewHasNoConfigurations_rendersNone', () => {
    show('provider', 'google');
    expect(items().length).toBe(0);
  });

  it('posture_whenChanged_persistsToSettings', () => {
    show('security');
    const settings: Settings = TestBed.inject(Settings);
    const select: HTMLSelectElement = rowSelect('Permission posture');

    select.value = 'auto-all';
    select.dispatchEvent(new Event('change'));

    expect(settings.aiPermissionPosture()).toBe('auto-all');
  });

  it('add_whenMethodClicked_appendsAConfigurationOfThatKindAndExpandsIt', () => {
    show('provider', 'google');
    const settings: Settings = TestBed.inject(Settings);
    const before: number = settings.aiConnections().length;

    addButton('API Key')?.click();
    fixture.detectChanges();

    const after: readonly AiConnection[] = settings.aiConnections();
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1].kind).toBe('google');
    // The newly-added configuration is expanded, so exactly one editor is rendered.
    expect(host.querySelectorAll('app-ai-connection-editor').length).toBe(1);
  });

  it('toggle_whenClicked_expandsTheConfigurationEditor', () => {
    show('provider', 'anthropic');
    expect(host.querySelectorAll('app-ai-connection-editor').length).toBe(0);

    const toggle: HTMLButtonElement | null =
      host.querySelector<HTMLButtonElement>('.ai-connections__toggle');
    toggle?.click();
    fixture.detectChanges();

    expect(host.querySelectorAll('app-ai-connection-editor').length).toBe(1);

    toggle?.click();
    fixture.detectChanges();
    expect(host.querySelectorAll('app-ai-connection-editor').length).toBe(0);
  });
});
