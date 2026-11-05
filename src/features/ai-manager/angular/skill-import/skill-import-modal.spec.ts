import { ApplicationRef, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GLOBAL_SCOPE } from '@shared/api/ai-types';
import type {
  SkillImportDraft,
  SkillImportEntry,
  SkillImportPlan,
} from '@shared/api/skill-import-channels';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { SkillImportModal } from './skill-import-modal';
import {
  ImportAcceptedProfile,
  ImportAcceptedSkill,
  ImportLeftOut,
  ImportPrompt,
  SkillImportSession,
} from './skill-import-session';

/**
 * Builds a draft.
 * @param name The name.
 * @returns Returns the draft.
 */
function draft(name: string): SkillImportDraft {
  return {
    name,
    description: `About ${name}.`,
    scope: GLOBAL_SCOPE,
    technologies: [],
    enabled: true,
    body: `# ${name}\n`,
  };
}

/**
 * Builds a candidate.
 * @param status Its status.
 * @returns Returns the entry.
 */
function entry(status: SkillImportEntry['status'] = 'ready'): SkillImportEntry {
  return {
    source: 'skills/acid.md',
    status,
    reason: status === 'ready' ? null : 'It is too short.',
    draft: draft('acid'),
    bundled: [],
    links: [],
  };
}

/**
 * A stand-in for the session: the state the modal reads, and the answers it gives.
 */
class FakeSession {
  public readonly prompt: WritableSignal<ImportPrompt | null> = signal<ImportPrompt | null>(null);
  public readonly plan: WritableSignal<SkillImportPlan | null> = signal<SkillImportPlan | null>({
    id: 'p',
    root: '/r',
    kind: 'convert',
    entries: [entry(), entry(), entry()],
    profiles: [],
    existingSkills: [],
    existingProfiles: [],
  });
  public readonly position: WritableSignal<number> = signal<number>(2);
  public readonly accepted: WritableSignal<readonly ImportAcceptedSkill[]> = signal<
    readonly ImportAcceptedSkill[]
  >([]);
  public readonly acceptedProfiles: WritableSignal<readonly ImportAcceptedProfile[]> = signal<
    readonly ImportAcceptedProfile[]
  >([]);
  public readonly leftOut: WritableSignal<readonly ImportLeftOut[]> = signal<
    readonly ImportLeftOut[]
  >([]);
  public readonly error: WritableSignal<string | null> = signal<string | null>(null);
  public readonly answers: unknown[] = [];
  public cancelled: number = 0;
  public readonly included: [string, boolean][] = [];

  public answer(value: unknown): void {
    this.answers.push(value);
  }

  public cancel(): void {
    this.cancelled += 1;
  }

  public include(source: string, included: boolean): void {
    this.included.push([source, included]);
  }

  public includeProfile(id: string, included: boolean): void {
    this.included.push([id, included]);
  }
}

describe('SkillImportModal (#1263)', () => {
  let session: FakeSession;
  let windows: FakeModalWindows;

  beforeEach(() => {
    session = new FakeSession();
    windows = new FakeModalWindows();
    TestBed.configureTestingModule({
      providers: [
        { provide: ModalWindows, useValue: windows },
        { provide: SkillImportSession, useValue: session },
      ],
    });
    const fixture: ComponentFixture<SkillImportModal> = TestBed.createComponent(SkillImportModal);
    fixture.componentRef.setInput('aiLabel', 'Claude');
    fixture.detectChanges();
  });

  /**
   * Shows a prompt and returns the dialog's content.
   * @param prompt The prompt.
   * @returns Returns the content host.
   */
  function show(prompt: ImportPrompt): HTMLElement {
    session.prompt.set(prompt);
    TestBed.inject(ApplicationRef).tick();
    TestBed.inject(ApplicationRef).tick();
    return windows.contentHost!;
  }

  /**
   * Finds a button by its label.
   * @param host The dialog.
   * @param label The label.
   * @returns Returns the button.
   */
  function button(host: HTMLElement, label: string): HTMLButtonElement {
    return [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate: HTMLButtonElement): boolean => candidate.textContent?.trim() === label,
    )!;
  }

  /**
   * Ticks a checkbox.
   * @param host The dialog.
   * @param index Which checkbox.
   */
  function tick(host: HTMLElement, index: number = 0): void {
    const box: HTMLInputElement =
      host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[index];
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    TestBed.inject(ApplicationRef).tick();
  }

  it('improve_offersImproveImportAsIsOrSkip_forOneOrForAllRemaining', () => {
    let host: HTMLElement = show({ kind: 'improve', entry: entry() });
    expect(host.textContent).toContain('File 2 of 3');
    button(host, 'Improve').click();
    button(host, 'Import as Is').click();
    button(host, 'Skip').click();
    tick(host);
    button(host, 'Skip').click();
    host = show({ kind: 'improve', entry: entry() });
    button(host, 'Cancel Import').click();

    expect(session.answers).toEqual([
      { choice: 'improve', all: false },
      { choice: 'as-is', all: false },
      { choice: 'skip', all: false },
      { choice: 'skip', all: true },
    ]);
    expect(session.cancelled).toBe(1);
  });

  it('repair_offersAiOrIgnore_inOneSentence', () => {
    const host: HTMLElement = show({ kind: 'repair', entry: entry('needs-ai') });

    expect(host.querySelector('.import__message')?.textContent?.trim()).toBe(
      "It is too short. An AI can turn it into a skill; you'll review the result.",
    );
    button(host, 'Import with AI').click();
    button(host, 'Ignore').click();
    expect(session.answers).toEqual(['ai', 'ignore']);
  });

  it('aiFailed_putsTheMainActionFirst_thenTryAgain', () => {
    const host: HTMLElement = show({
      kind: 'ai-failed',
      entry: entry(),
      reason: 'Busy.',
      notASkill: false,
      canUseDraft: true,
    });

    expect([...host.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
      'Import as Drafted',
      'Try Again',
      'Cancel Import',
    ]);
    button(host, 'Try Again').click();
    button(host, 'Import as Drafted').click();
    expect(session.answers).toEqual(['retry', { action: 'draft' }]);
  });

  it('clash_keepsWhatWasTyped_andSaysWhyItWasRefused', () => {
    const host: HTMLElement = show({
      kind: 'clash',
      subject: 'skill',
      label: 'skills/acid.md',
      name: 'acid',
      suggested: 'acid-2',
      withLibrary: true,
      attempted: 'Not Valid',
      error: 'Use lower-case letters, digits and hyphens.',
    });

    expect(host.querySelector<HTMLInputElement>('app-text-field input')?.value).toBe('Not Valid');
    expect(host.querySelector('app-alert')?.textContent).toContain('lower-case');
    expect(host.querySelector('h2')?.textContent).not.toMatch(/[“”"]/);
    tick(host);
    button(host, 'Replace').click();
    expect(session.answers).toEqual([{ action: 'replace', all: true }]);
  });

  it('review_whenTheEditedSkillIsInvalid_cannotBeAccepted', () => {
    const host: HTMLElement = show({
      kind: 'review',
      entry: entry(),
      original: draft('acid'),
      proposed: { ...draft('acid'), description: '' },
      purpose: 'improve',
    });

    expect(button(host, 'Accept').disabled).toBe(true);
    expect(host.querySelector('app-alert')?.textContent).toContain('description');
    expect(host.textContent).toContain('File 2 of 3');
  });

  it('summary_listsEverythingInOneTable_withChips_andNamesWhatItWillWrite', () => {
    session.accepted.set([
      {
        source: 'a.md',
        draft: draft('a'),
        replace: true,
        origin: 'improved',
        failure: null,
        included: true,
      },
      {
        source: 'b.md',
        draft: draft('b'),
        replace: false,
        origin: 'as-drafted',
        failure: 'Busy.',
        included: true,
      },
    ]);
    session.leftOut.set([{ label: 'README.md', kind: 'not-a-skill', reason: 'A README.' }]);
    const host: HTMLElement = show({ kind: 'summary' });

    expect([...host.querySelectorAll('th')].map((th) => th.textContent?.trim())).toEqual([
      '',
      'Name',
      'File',
      'Info',
    ]);
    const rows: HTMLElement[] = [...host.querySelectorAll<HTMLElement>('tbody tr')];
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Improved with AI');
    expect(rows[0].textContent).toContain('Replaces existing');
    expect(rows[1].textContent).toContain('AI improvement failed');
    expect(rows[1].textContent).toContain('Import as draft');
    expect(rows[2].textContent).toContain('Not a skill');
    expect(rows[2].querySelector<HTMLInputElement>('input[type=checkbox]')?.disabled).toBe(true);
    expect(button(host, 'Import 2 Skills')).toBeDefined();
    button(host, 'Import 2 Skills').click();
    expect(session.answers).toEqual(['import']);
  });

  it('summary_whenOnlyProfiles_saysHowManyProfilesItWillImport', () => {
    session.acceptedProfiles.set([
      {
        profile: {
          id: 'terse',
          name: 'Terse',
          scope: GLOBAL_SCOPE,
          instructions: 'x',
          enabled: true,
        },
        replace: false,
        included: true,
      },
    ]);
    const host: HTMLElement = show({ kind: 'summary' });

    expect(host.textContent).toContain('1 of 1 prompt profiles selected.');
    expect(button(host, 'Import 1 Profile')).toBeDefined();
  });

  it('summary_flagsLinksToFilesThatWillNotBeImported_andFollowsTheTicks', () => {
    session.plan.set({
      ...session.plan()!,
      entries: [
        { ...entry(), source: 'a.md', links: ['b.md', 'gone.md'] },
        { ...entry(), source: 'b.md', links: [] },
      ],
    });
    session.accepted.set([
      {
        source: 'a.md',
        draft: draft('a'),
        replace: false,
        origin: 'as-drafted',
        failure: null,
        included: true,
      },
      {
        source: 'b.md',
        draft: draft('b'),
        replace: false,
        origin: 'as-drafted',
        failure: null,
        included: true,
      },
    ]);
    let host: HTMLElement = show({ kind: 'summary' });
    const chip: () => Element | undefined = (): Element | undefined =>
      [...host.querySelectorAll('tbody tr')[0].querySelectorAll('app-chip')].find((c) =>
        c.textContent?.includes('broken'),
      );

    expect(chip()?.textContent?.trim()).toBe('1 broken link');
    expect(chip()?.getAttribute('title')).toContain('gone.md');

    session.accepted.update((skills) =>
      skills.map((skill) => (skill.source === 'b.md' ? { ...skill, included: false } : skill)),
    );
    host = show({ kind: 'summary' });
    expect(chip()?.textContent?.trim()).toBe('2 broken links');
  });
});
