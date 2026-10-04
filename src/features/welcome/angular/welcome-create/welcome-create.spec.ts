import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WelcomeCreate } from './welcome-create';

describe('WelcomeCreate', () => {
  let fixture: ComponentFixture<WelcomeCreate>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [WelcomeCreate] }).compileComponents();
    fixture = TestBed.createComponent(WelcomeCreate);
    await fixture.whenStable();
    host = fixture.nativeElement as HTMLElement;
  });

  /**
   * Gets the Generate Plan button.
   * @returns Returns it.
   */
  function generate(): HTMLButtonElement {
    return host.querySelector<HTMLButtonElement>('.create__generate')!;
  }

  /**
   * Types into the description.
   * @param text The text.
   */
  async function describe_(text: string): Promise<void> {
    const input: HTMLTextAreaElement = host.querySelector<HTMLTextAreaElement>('.create__input')!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  it('rail_showsTheFiveStages_onDescribe', () => {
    expect(
      Array.from(host.querySelectorAll<HTMLElement>('.create__step-title')).map(
        (title: HTMLElement): string => title.textContent.trim(),
      ),
    ).toEqual(['Describe', 'Plan', 'Configure', 'Generate', 'Open']);
    expect(host.querySelector('.create__step--current')?.textContent).toContain('Describe');
  });

  it('generate_isDisabled_untilThereIsADescription', async () => {
    expect(generate().disabled).toBe(true);

    await describe_('   ');
    expect(generate().disabled).toBe(true);

    await describe_('A todo app');
    expect(generate().disabled).toBe(false);
  });

  it('generate_saysPlainlyThatNothingGeneratesYet', async () => {
    await describe_('A todo app');

    generate().click();
    await fixture.whenStable();

    expect(host.querySelector('.create__notice')?.textContent).toContain('can’t generate');
  });

  it('editingTheDescription_clearsTheNotice', async () => {
    await describe_('A todo app');
    generate().click();
    await fixture.whenStable();

    await describe_('A todo app with sync');

    expect(host.querySelector('.create__notice')).toBeNull();
  });

  it('anExample_startsTheDescription', async () => {
    host.querySelector<HTMLButtonElement>('.welcome__example')!.click();
    await fixture.whenStable();

    expect(host.querySelector<HTMLTextAreaElement>('.create__input')!.value).toContain(
      'AI agent service',
    );
    expect(generate().disabled).toBe(false);
  });

  it('theTemplateExample_isNotAvailableYet', async () => {
    const cards: HTMLButtonElement[] = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.welcome__example'),
    );
    cards[cards.length - 1].click();
    await fixture.whenStable();

    expect(host.querySelector<HTMLTextAreaElement>('.create__input')!.value).toBe('');
    expect(cards[cards.length - 1].classList).toContain('welcome__example--unavailable');
  });

  it('theShortcut_asksForThePlan', async () => {
    await describe_('A todo app');
    const input: HTMLTextAreaElement = host.querySelector<HTMLTextAreaElement>('.create__input')!;
    const shortcut: string = host.querySelector('.create__shortcut')!.textContent.trim();

    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: shortcut.startsWith('⌘'),
        ctrlKey: !shortcut.startsWith('⌘'),
      }),
    );
    await fixture.whenStable();

    expect(host.querySelector('.create__notice')).not.toBeNull();
  });
});
