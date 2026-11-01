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
          error: null,
        });
      },
    };
    const assist: Partial<SkillAssist> = {
      isAvailable: true,
      improve: (original: SkillImportDraft): Promise<SkillAssistResult> => {
        improved.push(original.name);
        return Promise.resolve({ kind: 'draft', draft: { ...original, description: 'Improved.' } });
      },
      repair: (_source: string, original: SkillImportDraft): Promise<SkillAssistResult> =>
        Promise.resolve({ kind: 'draft', draft: { ...original, description: 'Repaired.' } }),
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
    session.answer('no');
    expect((await next())?.kind).toBe('repair');
    session.answer('ignore');
    expect((await next())?.kind).toBe('improve');
    session.answer('no');
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
    session.answer('yes');
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
    session.answer('yes-all');
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
    session.answer('no');
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
});
