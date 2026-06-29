import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SettingControl } from './setting-control';
import { Settings } from '@shared/angular/services/settings/settings';

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
    await render('application.showLauncherActions');
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('render_whenToggleControl_rendersAToggle', async () => {
    const element: HTMLElement = await render('application.showLauncherActions');
    expect(element.querySelector('app-toggle')).toBeTruthy();
  });

  it('render_whenSelectControl_rendersADropdownWithAnOptionPerChoice', async () => {
    const element: HTMLElement = await render('application.defaultDocumentType');
    expect(element.querySelector('app-dropdown')).toBeTruthy();
    expect(element.querySelectorAll('option').length).toBe(2);
  });

  it('render_whenButtonGroupControl_rendersAButtonGroupWithAnOptionPerChoice', async () => {
    const element: HTMLElement = await render('appearance.ribbonAlignment');
    expect(element.querySelector('app-button-group')).toBeTruthy();
    expect(element.querySelectorAll('.segmented__option').length).toBe(3);
  });

  it('render_whenColorControl_rendersColorSwatches', async () => {
    const element: HTMLElement = await render('appearance.accent');
    expect(element.querySelector('app-color-swatches')).toBeTruthy();
    expect(element.querySelectorAll('.swatch').length).toBe(8);
  });

  it('render_whenNumberControl_rendersANumberFieldWithTheRegistryRange', async () => {
    const element: HTMLElement = await render('application.undoStackSize');
    const input: HTMLInputElement = element.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(input.min).toBe('10');
    expect(input.max).toBe('1000');
  });

  it('render_whenTextControl_rendersATextFieldWithTheRegistryPlaceholder', async () => {
    const element: HTMLElement = await render('markdownEditor.fontFamily');
    const input: HTMLInputElement = element.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(input.placeholder).toBe('System Default');
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
    settings.setShowLauncherActions(true);
    const element: HTMLElement = await render('application.showLauncherActions');

    const checkbox: HTMLInputElement =
      element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(true);
  });

  it('onChange_whenToggled_writesTheValueThroughTheService', async () => {
    const element: HTMLElement = await render('application.showLauncherActions');

    const checkbox: HTMLInputElement =
      element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    expect(settings.get('application.showLauncherActions')).toBe(true);
  });

  it('onChange_whenButtonGroupOptionPicked_writesTheValueThroughTheService', async () => {
    const element: HTMLElement = await render('appearance.ribbonAlignment');

    const buttons: NodeListOf<HTMLButtonElement> =
      element.querySelectorAll<HTMLButtonElement>('.segmented__option');
    buttons[2].click();

    expect(settings.get('appearance.ribbonAlignment')).toBe('right');
  });

  it('onChange_whenSelectionPicked_writesTheValueThroughTheService', async () => {
    const element: HTMLElement = await render('application.defaultDocumentType');

    const select: HTMLSelectElement = element.querySelector<HTMLSelectElement>('select')!;
    select.value = 'markdown';
    select.dispatchEvent(new Event('change'));

    expect(settings.get('application.defaultDocumentType')).toBe('markdown');
  });

  it('onChange_whenNumberOutOfRange_clampsViaTheRegistry', async () => {
    const element: HTMLElement = await render('application.undoStackSize');

    const input: HTMLInputElement = element.querySelector<HTMLInputElement>('input[type="number"]')!;
    input.value = '5000';
    input.dispatchEvent(new Event('change'));

    expect(settings.get('application.undoStackSize')).toBe(1000);
  });
});
