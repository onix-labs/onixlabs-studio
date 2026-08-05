import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';

import { Button } from './button';

describe('Button', () => {
  let fixture: ComponentFixture<Button>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Button] }).compileComponents();
    fixture = TestBed.createComponent(Button);
    host = fixture.nativeElement as HTMLElement;
  });

  /**
   * Applies inputs and renders.
   * @param inputs The inputs to set.
   */
  function render(inputs: Record<string, unknown> = {}): void {
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
  }

  it('should create', () => {
    render();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('variant_whenUnstated_isOutline_theStandardButton', () => {
    render();

    expect(host.classList.contains('button--outline')).toBe(true);
  });

  it('variant_whenStated_marksTheHost_soTheStylesheetDrawsIt', () => {
    render({ variant: 'solid' });
    expect(host.classList.contains('button--solid')).toBe(true);

    render({ variant: 'none' });
    expect(host.classList.contains('button--none')).toBe(true);
    expect(host.classList.contains('button--solid')).toBe(false);
  });

  it('label_whenGiven_isRendered_andTheButtonIsNotIconOnly', () => {
    render({ label: 'Clear', icon: Icon.TRASH });

    expect(host.querySelector('.button__label')?.textContent).toContain('Clear');
    expect(host.querySelector('.button__icon')).not.toBeNull();
    expect(host.classList.contains('button--icon-only')).toBe(false);
  });

  it('iconOnly_isDerivedFromTheContent_notFromAFlag', () => {
    render({ icon: Icon.TRASH, ariaLabel: 'Remove' });

    expect(host.classList.contains('button--icon-only')).toBe(true);
    expect(host.querySelector('.button__label')).toBeNull();
    expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('Remove');
  });

  it('iconOnly_whenThereIsNoGlyphAtAll_isFalse', () => {
    // A button with neither icon nor label is empty, not square: squaring it would hide the fact.
    render();

    expect(host.classList.contains('button--icon-only')).toBe(false);
  });

  it('type_whenUnstated_isAPlainButton_soAFormIsNotSubmittedByAccident', () => {
    render();

    expect(host.querySelector('button')?.getAttribute('type')).toBe('button');
  });

  it('disabled_whenSet_disablesTheUnderlyingButton', () => {
    render({ label: 'Save', disabled: true });

    expect(host.querySelector('button')!.disabled).toBe(true);
  });

  it('tooltip_whenGiven_titlesTheButton', () => {
    render({ icon: Icon.TRASH, tooltip: 'Remove item' });

    expect(host.querySelector('button')?.getAttribute('title')).toBe('Remove item');
  });

  it('pressed_whenStated_announcesTheToggleState_andWearsItsOnTreatment', () => {
    render({ icon: Icon.TRASH, ariaLabel: 'Filter', pressed: true });

    expect(host.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
    expect(host.classList.contains('button--pressed')).toBe(true);
  });

  it('pressed_whenUnstated_leavesTheButtonWithoutAToggleState', () => {
    // An ordinary button is not a toggle, and must not claim to be one.
    render({ label: 'Save' });

    expect(host.querySelector('button')?.hasAttribute('aria-pressed')).toBe(false);
  });

  it('size_whenSmall_marksTheHost_soTheStylesheetTightensIt', () => {
    render({ label: 'Copy', size: 'small' });

    expect(host.classList.contains('button--small')).toBe(true);
  });

  it('tone_whenUnstated_isAccent_soAnOrdinaryButtonCarriesNoToneClass', () => {
    render({ label: 'Save' });

    expect(host.classList.contains('button--tone-success')).toBe(false);
    expect(host.classList.contains('button--tone-warning')).toBe(false);
    expect(host.classList.contains('button--tone-danger')).toBe(false);
    expect(host.classList.contains('button--tone-info')).toBe(false);
  });

  it('tone_whenStated_marksTheHost_soTheStylesheetColoursIt', () => {
    render({ label: 'Stop', tone: 'danger' });
    expect(host.classList.contains('button--tone-danger')).toBe(true);

    render({ label: 'Save', tone: 'success' });
    expect(host.classList.contains('button--tone-success')).toBe(true);
    expect(host.classList.contains('button--tone-danger')).toBe(false);
  });

  it('tone_isIndependentOfVariant_soAnyShapeCanCarryAnyTone', () => {
    render({ label: 'Stop', variant: 'solid', tone: 'danger' });

    expect(host.classList.contains('button--solid')).toBe(true);
    expect(host.classList.contains('button--tone-danger')).toBe(true);
  });

  it('loading_disablesTheButton_andRendersASpinnerAlongsideTheIcon', () => {
    render({ icon: Icon.PLAY, ariaLabel: 'Run', loading: true });

    const button: HTMLButtonElement = host.querySelector('button')!;
    // Disabled while in flight, so the action cannot be fired again; announced busy for assistive tech.
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(host.classList.contains('button--loading')).toBe(true);
    expect(host.classList.contains('button--loading-interactive')).toBe(false);
    // The spinner is present and spins; the caller's icon is still in the DOM (hidden by the
    // stylesheet), so it can be revealed without a re-render.
    const spinner: Element | null = host.querySelector('.button__icon--spinner');
    expect(spinner?.classList.contains('button__icon--spin')).toBe(true);
    expect(spinner?.querySelector('.ph-circle-notch')).not.toBeNull();
    expect(host.querySelector('.button__icon--content .ph-play')).not.toBeNull();
  });

  it('loadingInteractive_staysPressable_andMarksTheHostSoTheStylesheetRevealsTheIconOnHover', () => {
    render({ icon: Icon.STOP, ariaLabel: 'Stop', loading: true, loadingInteractive: true });

    // A cancellable loading button is not disabled — pointing at it and clicking is how you stop.
    expect(host.querySelector('button')!.disabled).toBe(false);
    expect(host.classList.contains('button--loading-interactive')).toBe(true);
    // Both glyphs are present; the stylesheet swaps them on hover.
    expect(host.querySelector('.button__icon--spinner .ph-circle-notch')).not.toBeNull();
    expect(host.querySelector('.button__icon--content .ph-stop')).not.toBeNull();
  });

  it('loading_whenFalse_showsOnlyTheCallersIconAndIsNotBusy', () => {
    render({ icon: Icon.PLAY, ariaLabel: 'Run', loading: false });

    expect(host.querySelector('.button__icon--spinner')).toBeNull();
    expect(host.querySelector('button')?.hasAttribute('aria-busy')).toBe(false);
    expect(host.querySelector('.button__icon--content .ph-play')).not.toBeNull();
  });
});
