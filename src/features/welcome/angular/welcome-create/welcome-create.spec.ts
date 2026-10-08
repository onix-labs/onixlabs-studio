import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { ProjectDraft } from './project-draft';
import { FakeProjectMachine, installed } from './project-draft.testing';
import { WelcomeCreate } from './welcome-create';

describe('WelcomeCreate', () => {
  let machine: FakeProjectMachine;
  let fixture: ComponentFixture<WelcomeCreate>;
  let host: HTMLElement;
  let openedCount: number;

  beforeEach(async () => {
    machine = new FakeProjectMachine();
    openedCount = 0;
    await TestBed.configureTestingModule({
      imports: [WelcomeCreate],
      providers: machine.providers(),
    }).compileComponents();
    fixture = TestBed.createComponent(WelcomeCreate);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentInstance.opened.subscribe((): void => {
      openedCount += 1;
    });
    await settle();
  });

  /**
   * Lets the draft's reads and change detection finish.
   */
  async function settle(): Promise<void> {
    await fixture.whenStable();
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve);
    });
    await fixture.whenStable();
  }

  /**
   * Gets the checklist's steps as "name:state", the state read from its classes.
   * @returns Returns them, in order.
   */
  function checklist(): string[] {
    return Array.from(host.querySelectorAll<HTMLButtonElement>('.create__step')).map(
      (step: HTMLButtonElement): string =>
        `${step.textContent.trim()}:${
          step.classList.contains('create__step--current')
            ? 'current'
            : step.classList.contains('create__step--done')
              ? 'done'
              : 'other'
        }`,
    );
  }

  /**
   * Gets the main button.
   * @returns Returns it.
   */
  function primary(): HTMLButtonElement {
    return host.querySelector<HTMLButtonElement>('.create__primary')!;
  }

  /**
   * Clicks the main button and lets it act.
   */
  async function clickPrimary(): Promise<void> {
    primary().click();
    await settle();
  }

  /**
   * Gets the values a dropdown offers, without its placeholder.
   * @param label The dropdown's accessible name.
   * @returns Returns them, in order.
   */
  function offered(label: string): string[] {
    return Array.from(
      host.querySelectorAll<HTMLOptionElement>(`select[aria-label="${label}"] option`),
    )
      .filter((option: HTMLOptionElement): boolean => !option.hidden)
      .map((option: HTMLOptionElement): string => option.value);
  }

  it('opensOnStart_withEveryStepInTheChecklist', () => {
    expect(checklist()).toEqual([
      'Start:current',
      'Project Details:other',
      'Technology:other',
      'Options:other',
      'Summary:other',
    ]);
    expect(host.querySelector('.create__title')!.textContent.trim()).toBe(
      'What do you want to build',
    );
    expect(host.querySelector('app-create-start')).not.toBeNull();
  });

  it('theButton_saysSkip_untilTheStepHasSomethingInIt_thenNext', async () => {
    expect(primary().textContent.trim()).toBe('Skip');

    host.querySelector<HTMLButtonElement>('.step__row')!.click();
    await settle();

    expect(primary().textContent.trim()).toBe('Next');
  });

  it('back_isOffOnTheFirstStep', () => {
    expect(
      host.querySelector<HTMLButtonElement>('.create__secondary:not(.create__over)')!.disabled,
    ).toBe(true);
  });

  it('walkingThrough_showsEachStep_andMarksThoseFilledIn', async () => {
    host.querySelector<HTMLButtonElement>('.step__row')!.click();
    await settle();
    await clickPrimary();
    expect(host.querySelector('app-create-details')).not.toBeNull();

    await clickPrimary();
    expect(host.querySelector('app-create-technology')).not.toBeNull();

    await clickPrimary();
    expect(host.querySelector('app-create-options')).not.toBeNull();

    await clickPrimary();
    expect(host.querySelector('app-create-summary')).not.toBeNull();
    expect(checklist()).toEqual([
      'Start:done',
      'Project Details:other',
      'Technology:other',
      'Options:other',
      'Summary:current',
    ]);
    expect(host.querySelector('.step__message')!.textContent).toContain(
      'I want to build a desktop application.',
    );
  });

  it('theChecklist_jumpsToAnyStep', async () => {
    host.querySelectorAll<HTMLButtonElement>('.create__step')[3].click();
    await settle();

    expect(host.querySelector('.create__title')!.textContent.trim()).toBe('Options');
  });

  it('theDetails_offerOnlyTheRepositoriesTheRunningPluginsCanMake', async () => {
    machine.running = ['clone'];
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [WelcomeCreate],
      providers: machine.providers(),
    }).compileComponents();
    fixture = TestBed.createComponent(WelcomeCreate);
    host = fixture.nativeElement as HTMLElement;
    await settle();

    TestBed.inject(ProjectDraft).goTo('details');
    await settle();
    expect(offered('Repository')).toEqual(['none', 'public', 'private']);

    machine.plugins.set([installed('version-control')]);
    await settle();
    expect(offered('Repository')).toEqual(['none']);
  });

  it('theLastStep_sendsToAnAgent_withoutAName', async () => {
    TestBed.inject(ProjectDraft).goTo('summary');
    await settle();
    expect(primary().textContent.trim()).toBe('Send to Agent');

    await clickPrimary();

    expect(
      TestBed.inject(Tabs)
        .tabs()
        .map((tab: Tab): string => tab.type),
    ).toEqual(['agent']);
    expect(openedCount).toBe(1);
  });

  it('theLastStep_sendsToAWorkspaceAgent_withANameAndAPlace', async () => {
    const draft: ProjectDraft = TestBed.inject(ProjectDraft);
    draft.name.set('todo-app');
    draft.goTo('summary');
    await settle();
    expect(primary().textContent.trim()).toBe('Send to Workspace Agent');

    await clickPrimary();

    expect(machine.created).toEqual([{ name: 'todo-app', repository: { kind: 'none' } }]);
    expect(openedCount).toBe(1);
  });

  it('aFailedSend_isShown_andTheWelcomeScreenStays', async () => {
    machine.outcome = { ok: false, error: 'It already exists.' };
    const draft: ProjectDraft = TestBed.inject(ProjectDraft);
    draft.name.set('todo-app');
    draft.goTo('summary');
    await settle();

    await clickPrimary();

    expect(host.querySelector('.create__error')!.textContent).toBe('It already exists.');
    expect(openedCount).toBe(0);
  });

  it('startOver_clearsTheDraft', async () => {
    host.querySelector<HTMLButtonElement>('.step__row')!.click();
    await settle();

    host.querySelector<HTMLButtonElement>('.create__over')!.click();
    await settle();

    expect(TestBed.inject(ProjectDraft).template()).toBeNull();
    expect(primary().textContent.trim()).toBe('Skip');
  });
});
