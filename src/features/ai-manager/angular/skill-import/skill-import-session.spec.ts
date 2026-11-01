import { TestBed } from '@angular/core/testing';
import { GLOBAL_SCOPE } from '@shared/api/ai-types';
import type { PromptProfile } from '@shared/api/prompt-profile-channels';
import type {
  SkillImportCommit,
  SkillImportDraft,
  SkillImportEntry,
  SkillImportPlan,
  SkillImportResult,
} from '@shared/api/skill-import-channels';
import { SkillTransfer } from '@shared/angular/services/skills/skill-transfer';
import { SkillAssist, SkillAssistResult } from '../skill-assist/skill-assist';
import { ImportPrompt, SkillImportSession } from './skill-import-session';

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
 * @param name The name.
 * @param status Its status.
 * @returns Returns the entry.
 */
function entry(name: string, status: SkillImportEntry['status'] = 'ready'): SkillImportEntry {
  return {
    source: `${name}.md`,
    status,
    reason: status === 'ready' ? null : 'It is too short.',
    draft: draft(name),
    bundled: [],
    links: [],
  };
}

/**
 * Builds a plan.
 * @param entries The candidates.
 * @param overrides Other fields.
 * @returns Returns the plan.
 */
function plan(
  entries: readonly SkillImportEntry[],
  overrides: Partial<SkillImportPlan> = {},
): SkillImportPlan {
  return {
    id: 'plan-1',
    root: '/source',
    kind: 'convert',
    entries,
    profiles: [],
    existingSkills: [],
    existingProfiles: [],
    ...overrides,
  };
}

describe('SkillImportSession (#1263)', () => {
  let session: SkillImportSession;
  let commits: SkillImportCommit[];
  let discarded: string[];
  let improved: string[];
  let chosen: SkillImportPlan;
  let improveAnswers: SkillAssistResult[];
  let repairAnswers: SkillAssistResult[];
  let commitErrors: (string | null)[];
  let signals: AbortSignal[];

  /**
   * Waits for the run to settle on its next question.
   * @returns Returns the prompt shown.
   */
  async function next(): Promise<ImportPrompt | null> {
    for (let turn: number = 0; turn < 20; turn += 1) {
      await Promise.resolve();
    }
    return session.prompt();
  }

  beforeEach(() => {
    commits = [];
    discarded = [];
    improved = [];
    improveAnswers = [];
    repairAnswers = [];
    commitErrors = [];
    signals = [];
    const transfer: Partial<SkillTransfer> = {
      choose: (): Promise<SkillImportPlan> => Promise.resolve(chosen),
      chooseProfiles: (): Promise<SkillImportPlan> => Promise.resolve(chosen),
      discard: (id: string): Promise<void> => {
        discarded.push(id);
        return Promise.resolve();
      },
      commit: (commit: SkillImportCommit): Promise<SkillImportResult> => {
        commits.push(commit);
        return Promise.resolve({
          skills: commit.skills.length,
          profiles: commit.profiles.length,
          linksRewritten: 2,
          error: commitErrors.shift() ?? null,
        });
      },
    };
    const assist: Partial<SkillAssist> = {
      isAvailable: true,
      improve: (
        original: SkillImportDraft,
        _model: unknown,
        signal?: AbortSignal,
      ): Promise<SkillAssistResult> => {
        improved.push(original.name);
        if (signal !== undefined) {
          signals.push(signal);
        }
        return Promise.resolve(
          improveAnswers.shift() ?? {
            kind: 'draft',
            draft: { ...original, description: 'Improved.' },
          },
        );
      },
      repair: (_source: string, original: SkillImportDraft): Promise<SkillAssistResult> =>
        Promise.resolve(
          repairAnswers.shift() ?? {
            kind: 'draft',
            draft: { ...original, description: 'Repaired.' },
          },
        ),
    };
    TestBed.configureTestingModule({
      providers: [
        SkillImportSession,
        { provide: SkillTransfer, useValue: transfer },
        { provide: SkillAssist, useValue: assist },
      ],
    });
    session = TestBed.inject(SkillImportSession);
  });

  it('start_whenAnsweredFileByFile_commitsWhatWasAccepted', async () => {
    chosen = plan([entry('alpha'), entry('stub', 'needs-ai'), entry('taken')], {
      existingSkills: ['taken'],
    });
    const outcome: Promise<string | null> = session.start({ providerId: 'claude', model: '' });

    expect((await next())?.kind).toBe('improve');
    session.answer({ choice: 'as-is', all: false });
    expect((await next())?.kind).toBe('repair');
    session.answer('ignore');
    expect((await next())?.kind).toBe('improve');
    session.answer({ choice: 'as-is', all: false });
    const clash: ImportPrompt | null = await next();
    expect(clash).toMatchObject({
      kind: 'clash',
      name: 'taken',
      suggested: 'taken-2',
      withLibrary: true,
    });
    session.answer({ action: 'rename', name: 'taken-2', all: false });
    expect((await next())?.kind).toBe('summary');
    expect(session.leftOut()).toEqual([
      { label: 'stub.md', kind: 'ignored', reason: 'It is too short.' },
    ]);
    session.answer('import');

    expect(await outcome).toBe('Imported 2 skills, with 2 links between them updated; 1 left out.');
    expect(
      commits[0].skills.map((skill) => [skill.source, skill.draft.name, skill.replace]),
    ).toEqual([
      ['alpha.md', 'alpha', false],
      ['taken.md', 'taken-2', false],
    ]);
  });

  it('start_whenImprovedAndReviewed_usesTheEditedVersion', async () => {
    chosen = plan([entry('alpha')]);
    const outcome: Promise<string | null> = session.start({ providerId: 'claude', model: '' });

    await next();
    session.answer({ choice: 'improve', all: false });
    const review: ImportPrompt | null = await next();
    expect(review?.kind).toBe('review');
    session.answer({ action: 'accept', draft: { ...draft('alpha'), description: 'Edited.' } });
    await next();
    session.answer('import');
    await outcome;

    expect(commits[0].skills[0].draft.description).toBe('Edited.');
  });

  it('start_whenYesToAll_improvesTheRestWithoutAsking', async () => {
    chosen = plan([entry('alpha'), entry('bravo'), entry('charlie')]);
    const outcome: Promise<string | null> = session.start({ providerId: 'claude', model: '' });

    await next();
    session.answer({ choice: 'improve', all: true });
    expect((await next())?.kind).toBe('summary');
    expect(session.accepted().map((skill) => skill.origin)).toEqual([
      'improved-auto',
      'improved-auto',
      'improved-auto',
    ]);
    session.include('bravo.md', false);
    session.answer('import');
    await outcome;

    expect(improved.sort()).toEqual(['alpha', 'bravo', 'charlie']);
    expect(commits[0].skills.map((skill) => skill.draft.name)).toEqual(['alpha', 'charlie']);
    expect(commits[0].skills[0].draft.description).toBe('Improved.');
  });

  it('cancel_midRun_writesNothingAndDiscardsThePlan', async () => {
    chosen = plan([entry('alpha'), entry('bravo')]);
    const outcome: Promise<string | null> = session.start({ providerId: 'claude', model: '' });

    await next();
    session.answer({ choice: 'as-is', all: false });
    await next();
    session.cancel();

    expect(await outcome).toBeNull();
    expect(commits).toEqual([]);
    expect(discarded).toEqual(['plan-1']);
    expect(session.plan()).toBeNull();
  });

  it('start_whenRestoring_asksNothingButClashes', async () => {
    chosen = plan([entry('alpha'), entry('bravo')], {
      kind: 'restore',
      existingSkills: ['bravo'],
      profiles: [
        { id: 'terse', name: 'Terse', scope: GLOBAL_SCOPE, instructions: 'x', enabled: true },
      ],
      existingProfiles: ['terse'],
    });
    const outcome: Promise<string | null> = session.start({ providerId: 'claude', model: '' });

    expect(await next()).toMatchObject({ kind: 'clash', subject: 'skill', name: 'bravo' });
    session.answer({ action: 'replace', all: false });
    expect(await next()).toMatchObject({ kind: 'clash', subject: 'profile', name: 'terse' });
    session.answer({ action: 'skip', all: false });
    expect((await next())?.kind).toBe('summary');
    session.answer('import');
    await outcome;

    expect(improved).toEqual([]);
    expect(commits[0].skills.map((skill) => [skill.draft.name, skill.replace])).toEqual([
      ['alpha', false],
      ['bravo', true],
    ]);
    expect(commits[0].profiles).toEqual([]);
  });

  it('start_whenNoAi_neverOffersImprovements', async () => {
    chosen = plan([entry('alpha')]);
    const outcome: Promise<string | null> = session.start(null);

    expect((await next())?.kind).toBe('summary');
    session.answer('import');
    await outcome;

    expect(commits[0].skills).toHaveLength(1);
  });

  it('start_whenImportingProfiles_asksOnlyClashesAndHonoursUnticking', async () => {
    const profile: (id: string) => PromptProfile = (id: string): PromptProfile => ({
      id,
      name: id,
      scope: GLOBAL_SCOPE,
      instructions: 'x',
      enabled: true,
    });
    chosen = plan([], {
      kind: 'restore',
      profiles: [profile('terse'), profile('tone'), profile('house')],
      existingProfiles: ['terse'],
    });
    const outcome: Promise<string | null> = session.start(null, 'profiles');

    expect(await next()).toMatchObject({ kind: 'clash', subject: 'profile', name: 'terse' });
    session.answer({ action: 'rename', name: 'terse-2', all: false });
    expect((await next())?.kind).toBe('summary');
    session.includeProfile('tone', false);
    session.answer('import');
    await outcome;

    expect(commits[0].profiles.map((item) => [item.profile.id, item.replace])).toEqual([
      ['terse-2', false],
      ['house', false],
    ]);
    expect(commits[0].skills).toEqual([]);
  });

  it('improve_whenTheAiFails_andTheDraftIsUsed_flagsTheFailureInTheSummary', async () => {
    improveAnswers = [{ kind: 'error', reason: 'The AI took too long to answer.' }];
    chosen = plan([entry('alpha')]);
    const outcome: Promise<string | null> = session.start({ providerId: 'claude', model: '' });

    await next();
    session.answer({ choice: 'improve', all: false });
    expect(await next()).toMatchObject({ kind: 'ai-failed', canUseDraft: true });
    session.answer({ action: 'draft' });
    expect((await next())?.kind).toBe('summary');

    expect(session.accepted()[0]).toMatchObject({
      origin: 'as-drafted',
      failure: 'The AI took too long to answer.',
    });
    session.answer('import');
    await outcome;
    expect(commits[0].skills[0].draft.description).toBe('About alpha.');
  });

  it('improve_whenTheAiFails_andTryAgain_asksTheAiAgain', async () => {
    improveAnswers = [{ kind: 'error', reason: 'Busy.' }];
    chosen = plan([entry('alpha')]);
    const outcome: Promise<string | null> = session.start({ providerId: 'claude', model: '' });

    await next();
    session.answer({ choice: 'improve', all: false });
    await next();
    session.answer('retry');
    expect((await next())?.kind).toBe('review');
    expect(improved).toEqual(['alpha', 'alpha']);
    session.cancel();
    await outcome;
  });

  it('review_whenDeclined_importsTheFileAsDrafted', async () => {
    chosen = plan([entry('alpha')]);
    const outcome: Promise<string | null> = session.start({ providerId: 'claude', model: '' });

    await next();
    session.answer({ choice: 'improve', all: false });
    await next();
    session.answer({ action: 'draft' });
    await next();
    expect(session.accepted()[0]).toMatchObject({ origin: 'as-drafted', failure: null });
    session.answer('import');
    await outcome;
  });

  it('repair_whenAcceptedOrRefused_convertsOrLeavesItOutWithTheRightReason', async () => {
    repairAnswers = [
      { kind: 'draft', draft: { ...draft('stub'), description: 'Repaired.' } },
      { kind: 'not-a-skill', reason: 'It is an index.' },
    ];
    chosen = plan([entry('stub', 'needs-ai'), entry('index', 'needs-ai')]);
    const outcome: Promise<string | null> = session.start({ providerId: 'claude', model: '' });

    await next();
    session.answer('ai');
    expect(await next()).toMatchObject({ kind: 'review', purpose: 'repair' });
    session.answer({ action: 'accept', draft: { ...draft('stub'), description: 'Repaired.' } });
    await next();
    session.answer('ai');
    expect(await next()).toMatchObject({ kind: 'ai-failed', notASkill: true, canUseDraft: false });
    session.answer({ action: 'ignore' });
    expect((await next())?.kind).toBe('summary');

    expect(session.accepted().map((skill) => [skill.draft.name, skill.origin])).toEqual([
      ['stub', 'converted'],
    ]);
    expect(session.leftOut()).toEqual([
      { label: 'index.md', kind: 'not-a-skill', reason: 'It is an index.' },
    ]);
    session.cancel();
    await outcome;
  });

  it('clash_whenTheNameTypedIsUnusable_asksAgainSayingWhy', async () => {
    chosen = plan([entry('taken')], { existingSkills: ['taken', 'taken-2'] });
    const outcome: Promise<string | null> = session.start(null);

    expect(await next()).toMatchObject({ kind: 'clash', suggested: 'taken-3', error: null });
    session.answer({ action: 'rename', name: 'Not Valid', all: false });
    expect(await next()).toMatchObject({
      kind: 'clash',
      attempted: 'Not Valid',
      error: 'Use lower-case letters, digits and hyphens.',
    });
    session.answer({ action: 'rename', name: 'taken-2', all: false });
    expect(await next()).toMatchObject({ error: 'taken-2 is taken too.' });
    session.answer({ action: 'rename', name: 'fresh', all: false });
    expect((await next())?.kind).toBe('summary');
    expect(session.accepted()[0].draft.name).toBe('fresh');
    session.cancel();
    await outcome;
  });

  it('clash_whenRenameForAllRemaining_givesLaterClashesTheirSuggestedNames', async () => {
    chosen = plan([entry('one'), entry('two')], { existingSkills: ['one', 'two'] });
    const outcome: Promise<string | null> = session.start(null);

    await next();
    session.answer({ action: 'rename', name: 'one-renamed', all: true });
    expect((await next())?.kind).toBe('summary');
    expect(session.accepted().map((skill) => skill.draft.name)).toEqual(['one-renamed', 'two-2']);
    session.cancel();
    await outcome;
  });

  it('clash_whenTwoFilesShareAName_replacingKeepsOnlyTheLaterOne', async () => {
    chosen = plan([
      { ...entry('dup'), source: 'a/dup.md' },
      { ...entry('dup'), source: 'b/dup.md' },
    ]);
    const outcome: Promise<string | null> = session.start(null);

    expect(await next()).toMatchObject({ kind: 'clash', name: 'dup', withLibrary: false });
    session.answer({ action: 'replace', all: false });
    await next();
    expect(session.accepted().map((skill) => [skill.source, skill.replace])).toEqual([
      ['b/dup.md', false],
    ]);
    session.cancel();
    await outcome;
  });

  it('summary_whenTheCommitFails_showsWhyAndLetsYouTryAgain', async () => {
    commitErrors = ['The import could not be written, so nothing was changed.'];
    chosen = plan([entry('alpha')]);
    const outcome: Promise<string | null> = session.start(null);

    await next();
    session.answer('import');
    expect((await next())?.kind).toBe('summary');
    expect(session.error()).toBe('The import could not be written, so nothing was changed.');
    session.answer('import');

    expect(await outcome).toContain('Imported 1 skill');
    expect(commits).toHaveLength(2);
    expect(session.error()).toBeNull();
  });

  it('cancel_whileTheAiWorks_abortsItsRuns', async () => {
    chosen = plan([entry('alpha'), entry('bravo')]);
    const outcome: Promise<string | null> = session.start({ providerId: 'claude', model: '' });

    await next();
    session.answer({ choice: 'improve', all: true });
    await next();
    session.cancel();

    expect(await outcome).toBeNull();
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal: AbortSignal): boolean => signal.aborted)).toBe(true);
    expect(commits).toEqual([]);
  });

  it('start_whenPressedTwiceWhileTheDialogIsUp_opensOneDialog', async () => {
    let opened: number = 0;
    let resolve: (value: SkillImportPlan | null) => void = (): void => undefined;
    const transfer: SkillTransfer = TestBed.inject(SkillTransfer);
    transfer.choose = (): Promise<SkillImportPlan | null> => {
      opened += 1;
      return new Promise<SkillImportPlan | null>((done) => {
        resolve = done;
      });
    };
    const first: Promise<string | null> = session.start(null);
    const second: Promise<string | null> = session.start(null);
    resolve(null);

    expect(await second).toBeNull();
    expect(await first).toBeNull();
    expect(opened).toBe(1);
  });

  it('improveQuestion_whenSkipped_leavesTheFileOut_andSkipForAllLeavesTheRestOut', async () => {
    chosen = plan([entry('alpha'), entry('bravo'), entry('charlie'), entry('stub', 'needs-ai')]);
    const outcome: Promise<string | null> = session.start({ providerId: 'claude', model: '' });

    await next();
    session.answer({ choice: 'skip', all: false });
    await next();
    session.answer({ choice: 'skip', all: true });
    expect((await next())?.kind).toBe('repair');
    session.answer('ignore');
    expect((await next())?.kind).toBe('summary');

    expect(session.accepted()).toEqual([]);
    expect(session.leftOut().map((item) => [item.label, item.kind])).toEqual([
      ['alpha.md', 'skipped'],
      ['bravo.md', 'skipped'],
      ['charlie.md', 'skipped'],
      ['stub.md', 'ignored'],
    ]);
    session.cancel();
    await outcome;
  });
});
