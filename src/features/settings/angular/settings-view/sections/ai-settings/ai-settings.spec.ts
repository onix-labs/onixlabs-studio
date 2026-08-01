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

  it('render_whenShown_rendersARowPerGlobalControl', () => {
    // Permission posture, token cap, run timeout, session lifetime, agent shell, Claude CLI, CLI path.
    expect(host.querySelectorAll('app-setting-row').length).toBe(7);
  });

  it('render_whenShown_rendersAnItemPerSeedConnection', () => {
    const settings: Settings = TestBed.inject(Settings);
    expect(items().length).toBe(settings.aiConnections().length);
    expect(items().length).toBeGreaterThan(0);
  });

  it('posture_whenChanged_persistsToSettings', () => {
    const settings: Settings = TestBed.inject(Settings);
    const select: HTMLSelectElement = rowSelect('Permission posture');

    select.value = 'auto-all';
    select.dispatchEvent(new Event('change'));

    expect(settings.aiPermissionPosture()).toBe('auto-all');
  });

  it('add_whenClicked_appendsAConnectionAndExpandsIt', () => {
    const settings: Settings = TestBed.inject(Settings);
    const before: number = settings.aiConnections().length;

    const add: HTMLButtonElement | undefined = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button: HTMLButtonElement): boolean => button.textContent?.trim() === 'Add');
    add?.click();
    fixture.detectChanges();

    const after: readonly AiConnection[] = settings.aiConnections();
    expect(after.length).toBe(before + 1);
    // The newly-added connection is expanded, so exactly one editor is rendered.
    expect(host.querySelectorAll('app-ai-connection-editor').length).toBe(1);
  });

  it('toggle_whenClicked_expandsTheConnectionEditor', () => {
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
