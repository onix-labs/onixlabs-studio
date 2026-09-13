import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { AiConnection } from '@shared/api/ai-types';
import type { PluginSummary } from '@shared/api/plugin-channels';
import { Settings } from '@shared/angular/services/settings/settings';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { AiConnections } from '@shared/angular/services/ai-connections/ai-connections';
import { AiSettingsSection } from './ai-settings';

/**
 * One installed harness contributing an Anthropic page with both sign-in methods.
 *
 * ⛔ There is no built-in page to fall back on (#653): every company page comes from an installed
 * plugin, so a spec exercising a page has to install one.
 */
const INSTALLED: readonly PluginSummary[] = [
  {
    id: 'test.claude-harness',
    name: 'Claude',
    description: 'Test harness.',
    state: 'installed',
    version: '1.0.0',
    installedVersion: '1.0.0',
    installedPath: '/installed/claude',
    detail: null,
    origin: null,
    contributions: [
      {
        slot: 'agent-harness',
        id: 'test.claude-harness',
        displayName: 'Claude',
        priority: 100,
        providers: [
          {
            kind: 'anthropic',
            company: 'Anthropic',
            description: 'Anthropic models.',
            authMethods: [
              {
                auth: 'claude-login',
                buttonLabel: 'Subscription',
                defaultDisplayName: 'Claude',
              },
              { auth: 'api-key', buttonLabel: 'API Key', defaultDisplayName: 'Anthropic API' },
            ],
          },
        ],
      },
    ],
  } as unknown as PluginSummary,
];

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
      providers: [
        { provide: Plugins, useValue: { plugins: (): readonly PluginSummary[] => INSTALLED } },
      ],
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
    const connections: AiConnections = TestBed.inject(AiConnections);
    connections.add('anthropic');
    connections.add('anthropic');

    show('provider', 'anthropic');
    expect(items().length).toBe(2);
    expect(addButton('Subscription')).toBeTruthy();
    expect(addButton('API Key')).toBeTruthy();
  });

  it('render_whenProviderViewHasNoConfigurations_rendersNone', () => {
    show('provider', 'anthropic');
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
    show('provider', 'anthropic');
    const settings: Settings = TestBed.inject(Settings);
    const before: number = settings.aiConnections().length;

    addButton('API Key')?.click();
    fixture.detectChanges();

    const after: readonly AiConnection[] = settings.aiConnections();
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1].kind).toBe('anthropic');
    // The newly-added configuration is expanded, so exactly one editor is rendered.
    expect(host.querySelectorAll('app-ai-connection-editor').length).toBe(1);
  });

  it('toggle_whenClicked_expandsTheConfigurationEditor', () => {
    TestBed.inject(AiConnections).add('anthropic');
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
