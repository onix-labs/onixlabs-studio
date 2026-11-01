import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GLOBAL_SCOPE } from '@shared/api/ai-types';
import type {
  SkillExportResult,
  SkillImportDraft,
  SkillImportPlan,
  SkillImportResult,
} from '@shared/api/skill-import-channels';
import { PromptProfileLibrary } from '../prompt-profiles/prompt-profile-library';
import { LibraryTransfer } from './library-transfer';
import { SkillLibrary } from './skill-library';

describe('LibraryTransfer', () => {
  let base: string;
  let source: string;
  let skills: SkillLibrary;
  let profiles: PromptProfileLibrary;
  let transfer: LibraryTransfer;

  /**
   * Writes a file under the import source.
   * @param path The relative path.
   * @param text The contents.
   */
  function write(path: string, text: string): void {
    mkdirSync(dirname(join(source, path)), { recursive: true });
    writeFileSync(join(source, path), text);
  }

  /**
   * Builds a draft.
   * @param name The name.
   * @param body The body.
   * @returns Returns the draft.
   */
  function draft(name: string, body: string = `# ${name}\n`): SkillImportDraft {
    return {
      name,
      description: `About ${name}.`,
      scope: GLOBAL_SCOPE,
      technologies: [],
      enabled: true,
      body,
    };
  }

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'transfer-'));
    source = join(base, 'source');
    mkdirSync(source);
    skills = new SkillLibrary(join(base, 'skills'));
    profiles = new PromptProfileLibrary(join(base, 'prompt-profiles'));
    transfer = new LibraryTransfer(skills, profiles);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('commit_whenConverting_writesSkillsAndRewritesLinksToFinalNames', async () => {
    write('a.md', '# A\n\nSee [B](b.md).\n');
    write('b.md', '# B\n');
    const plan: SkillImportPlan = await transfer.scan(source);
    const result: SkillImportResult = await transfer.commit({
      planId: plan.id,
      skills: [
        { source: 'a.md', draft: draft('alpha', '# A\n\nSee [B](b.md).\n'), replace: false },
        { source: 'b.md', draft: draft('bravo'), replace: false },
      ],
      profiles: [],
    });
    expect(result).toEqual({ skills: 2, profiles: 0, linksRewritten: 1, error: null });
    expect((await skills.read('alpha'))?.body).toContain('[B](../bravo/SKILL.md)');
    expect(readdirSync(base).sort()).toEqual(['prompt-profiles', 'skills', 'source']);
  });

  it('commit_whenNameExistsAndNotReplacing_writesNothing', async () => {
    await skills.save({ ...draft('alpha'), body: 'old' });
    write('a.md', '# A\n');
    const plan: SkillImportPlan = await transfer.scan(source);
    const result: SkillImportResult = await transfer.commit({
      planId: plan.id,
      skills: [{ source: 'a.md', draft: draft('alpha'), replace: false }],
      profiles: [],
    });
    expect(result.error).toContain('already exists');
    expect((await skills.read('alpha'))?.body).toBe('old\n');
  });

  it('commit_whenReplacing_swapsTheSkill', async () => {
    await skills.save({ ...draft('alpha'), body: 'old' });
    write('a.md', '# A\n');
    const plan: SkillImportPlan = await transfer.scan(source);
    await transfer.commit({
      planId: plan.id,
      skills: [{ source: 'a.md', draft: draft('alpha', 'new'), replace: true }],
      profiles: [],
    });
    expect((await skills.read('alpha'))?.body).toBe('new\n');
  });

  it('commit_whenAProfileFails_rollsBackTheSkillsToo', async () => {
    await skills.save({ ...draft('alpha'), body: 'old' });
    write('a.md', '# A\n');
    const plan: SkillImportPlan = await transfer.scan(source);
    // A folder where the profile file should go makes its write fail after the skills moved in.
    mkdirSync(join(base, 'prompt-profiles', 'terse.md'), { recursive: true });
    const result: SkillImportResult = await transfer.commit({
      planId: plan.id,
      skills: [{ source: 'a.md', draft: draft('alpha', 'new'), replace: true }],
      profiles: [
        {
          profile: {
            id: 'terse',
            name: 'Terse',
            scope: GLOBAL_SCOPE,
            instructions: 'x',
            enabled: true,
          },
          replace: true,
        },
      ],
    });
    expect(result.error).not.toBeNull();
    expect((await skills.read('alpha'))?.body).toBe('old\n');
    expect(readdirSync(base).sort()).toEqual(['prompt-profiles', 'skills', 'source']);
  });

  it('commit_whenSourceNotInPlan_refuses', async () => {
    const plan: SkillImportPlan = await transfer.scan(source);
    const result: SkillImportResult = await transfer.commit({
      planId: plan.id,
      skills: [{ source: '../../etc/passwd', draft: draft('x'), replace: false }],
      profiles: [],
    });
    expect(result.error).toContain('not part of this import');
  });

  it('export_thenScan_roundTripsSkillsAndProfiles', async () => {
    await skills.save(draft('alpha'));
    writeFileSync(join(base, 'note.txt'), '');
    await profiles.save({
      id: 'terse',
      name: 'Be: terse',
      scope: GLOBAL_SCOPE,
      instructions: 'Short.',
      enabled: true,
    });
    const exported: SkillExportResult = await transfer.export(
      base,
      new Date('2026-11-01T12:00:00Z'),
    );
    expect(exported).toMatchObject({ skills: 1, profiles: 1, error: null });
    expect(exported.folder?.endsWith('ONIXLabs Studio AI Library 2026-11-01')).toBe(true);
    expect(
      (
        JSON.parse(readFileSync(join(exported.folder!, 'manifest.json'), 'utf8')) as {
          format: string;
        }
      ).format,
    ).toBe('onixlabs-studio-ai-library');
    const again: SkillExportResult = await transfer.export(base, new Date('2026-11-01T12:00:00Z'));
    expect(again.folder?.endsWith('(2)')).toBe(true);
    const plan: SkillImportPlan = await transfer.scan(exported.folder!);
    expect(plan.kind).toBe('restore');
    expect(plan.entries.map((entry) => entry.draft.name)).toEqual(['alpha']);
    expect(plan.profiles[0]).toMatchObject({
      id: 'terse',
      name: 'Be: terse',
      instructions: 'Short.',
    });
    expect(plan.existingSkills).toEqual(['alpha']);
    expect(existsSync(join(source))).toBe(true);
  });
});
