import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SettingControl } from './setting-control';
import { Settings } from '@shared/angular/services/settings/settings';
import { ACCENT_COLORS } from '@shared/angular/services/theme/theme';

describe('SettingControl', () => {
  let fixture: ComponentFixture<SettingControl>;
  let settings: Settings;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [SettingControl],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingControl);
    settings = TestBed.inject(Settings);
  });

  /**
   * Renders the control bound to the given setting key.
   * @param key The setting key to bind.
   */
  async function render(key: string): Promise<HTMLElement> {
    fixture.componentRef.setInput('key', key);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('should create', async () => {
    await render('textEditor.global.showLineNumbers');
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('render_whenToggleControl_rendersAToggle', async () => {
    const element: HTMLElement = await render('textEditor.global.showLineNumbers');
    expect(element.querySelector('app-toggle')).toBeTruthy();
  });

  it('render_whenSelectControl_rendersADropdownWithAnOptionPerChoice', async () => {
    const element: HTMLElement = await render('application.printMargin');
    expect(element.querySelector('app-dropdown')).toBeTruthy();
    expect(element.querySelectorAll('option').length).toBe(3);
  });

  it('render_whenColorControl_rendersADropdownWithAColourChipPerSwatch', async () => {
    const element: HTMLElement = await render('appearance.accent');
    expect(element.querySelector('app-dropdown')).toBeTruthy();
    expect(element.querySelectorAll('option').length).toBe(ACCENT_COLORS.length);
    expect(element.querySelectorAll('.dropdown__chip').length).toBeGreaterThan(0);
  });

  it('render_whenTextControl_rendersATextFieldWithTheRegistryPlaceholder', async () => {
    const element: HTMLElement = await render('lsp.path.typescriptServer');
    const input: HTMLInputElement = element.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(input.placeholder).toBe('Bundled');
  });

  it('render_whenCustomControl_rendersNoGenericControl', async () => {
    const element: HTMLElement = await render('textEditor.profiles');
    expect(
      element.querySelector('app-toggle, app-dropdown, app-number-field, app-text-field'),
    ).toBeNull();
  });

  it('render_whenSecurityOwnedSetting_rendersADropdownWithAnOptionPerChoice', async () => {
    const element: HTMLElement = await render('security.imagePolicy');
    expect(element.querySelector('app-dropdown')).toBeTruthy();
    expect(element.querySelectorAll('option').length).toBe(3);
  });

  it('render_whenLspOwnedToggle_reflectsTheEnabledState', async () => {
    const element: HTMLElement = await render('lsp.server.typescript.enabled');
    const checkbox: HTMLInputElement =
      element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(true);
  });

  it('render_whenValueSet_reflectsTheCurrentValue', async () => {
    settings.set('textEditor.global.showLineNumbers', false);
    const element: HTMLElement = await render('textEditor.global.showLineNumbers');

    const checkbox: HTMLInputElement =
      element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(false);
  });

  it('onChange_whenToggled_writesTheValueThroughTheService', async () => {
    settings.set('textEditor.global.showLineNumbers', true);
    const element: HTMLElement = await render('textEditor.global.showLineNumbers');

    const checkbox: HTMLInputElement =
      element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));

    expect(settings.get('textEditor.global.showLineNumbers')).toBe(false);
  });

  it('onChange_whenSelectionPicked_writesTheValueThroughTheService', async () => {
    const element: HTMLElement = await render('application.printMargin');

    const select: HTMLSelectElement = element.querySelector<HTMLSelectElement>('select')!;
    select.value = 'wide';
    select.dispatchEvent(new Event('change'));

    expect(settings.get('application.printMargin')).toBe('wide');
  });

  it('onChange_whenNumericSelectionPicked_writesANumberThroughTheService', async () => {
    const element: HTMLElement = await render('application.undoStackSize');

    const select: HTMLSelectElement = element.querySelector<HTMLSelectElement>('select')!;
    select.value = '200';
    select.dispatchEvent(new Event('change'));

    expect(settings.get('application.undoStackSize')).toBe(200);
  });
});
