import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Settings } from '@shared/angular/services/settings/settings';
import { SetupStepSettings } from './setup-step-settings';

describe('SetupStepSettings', () => {
  let fixture: ComponentFixture<SetupStepSettings>;
  let host: HTMLElement;

  /**
   * Renders the component for a list of setting keys.
   * @param keys The keys the step names.
   * @returns Returns a promise that resolves once the view has settled.
   */
  async function render(keys: readonly string[]): Promise<void> {
    fixture = TestBed.createComponent(SetupStepSettings);
    fixture.componentRef.setInput('keys', keys);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /**
   * Reads the labels of the rendered setting rows.
   * @returns Returns the labels in render order.
   */
  function rowLabels(): readonly string[] {
    return Array.from(host.querySelectorAll('.setting-row__label')).map(
      (label: Element): string => label.textContent?.trim() ?? '',
    );
  }

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [SetupStepSettings] }).compileComponents();
  });

  it('render_whenGivenKeys_showsARowPerKeyInTheStatedOrder', async () => {
    // The order is the step's, not the registry's: a step curates, so it also sequences.
    await render(['notifications.toastDuration', 'accessibility.showTooltips']);

    expect(rowLabels()).toEqual(['Toast duration', 'Tooltips on icon-only controls']);
  });

  it('render_whenGivenNoKeys_showsNothing', async () => {
    await render([]);

    expect(rowLabels()).toEqual([]);
  });

  it('render_whenAKeyNamesNothing_dropsItRatherThanRenderingABlankRow', async () => {
    // A typo or a since-removed setting must not reach the user as an empty row they cannot tell
    // apart from a control that failed to load.
    await render(['accessibility.showTooltips', 'nonsense.notASetting']);

    expect(rowLabels()).toEqual(['Tooltips on icon-only controls']);
  });

  it('render_whenAKeyIsCustomRendered_skipsIt', async () => {
    // Custom controls are structurally complex and rendered by bespoke hosts; the generic renderer
    // skips them exactly as the settings section does.
    await render(['terminal.defaultShell', 'accessibility.showTooltips']);

    expect(rowLabels()).toEqual(['Tooltips on icon-only controls']);
  });

  it('render_whenASettingIsQualifiedOnAnother_showsItOnlyWhileTheConditionHolds', async () => {
    // The menu appearance applies to the icon mode alone, so it appears and disappears with it.
    const settings: Settings = TestBed.inject(Settings);
    settings.assign('application.menuMode', 'hidden');

    await render(['application.menuMode', 'application.menuAppearance']);
    expect(rowLabels()).toEqual(['Application menu']);

    settings.assign('application.menuMode', 'icon');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(rowLabels()).toEqual(['Application menu', 'Application menu appearance']);
  });

  it('render_whenTheSettingStatesShortText_showsThatRatherThanTheFullDescription', async () => {
    // A wizard step shows settings to someone who did not go looking for them; a setting whose full
    // text runs to a paragraph is one whose text does not get read.
    await render(['display.graphicsAcceleration']);

    const description: string =
      host.querySelector('.setting-row__description')?.textContent?.trim() ?? '';
    expect(description).toContain('Leave this automatic unless the interface renders oddly');
    expect(description).not.toContain('drops squircle corners');
    // The machine-specific hint survives the shortening.
    expect(description).toContain('Automatic resolves to');
  });

  it('render_whenTheSettingIsOwnedElsewhere_bindsThroughItsOwner', async () => {
    // The graphics level belongs to the Display service, not the settings store. The step names it
    // like any other key and the binding layer routes it.
    await render(['display.graphicsAcceleration']);

    expect(rowLabels()).toEqual(['Graphics Acceleration']);
  });
});
