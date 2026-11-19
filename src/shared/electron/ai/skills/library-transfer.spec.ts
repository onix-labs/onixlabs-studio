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
import type { PersonaEntry } from '@shared/api/persona-channels';
import { PersonaLibrary } from '../persona/persona-library';
import { LibraryTransfer } from './library-transfer';
import { SkillLibrary } from './skill-library';

/**
 * Builds a persona entry the user wrote, in the core.
 * @param id The id.
 * @param name The name.
 * @param text The text.
 * @returns Returns the entry.
 */
function entryOf(id: string, name: string, text: string): PersonaEntry {
  return {
    id,
    name,
    text,
    why: '',
    tags: [],
    links: [],
    scope: GLOBAL_SCOPE,
    layer: 'core',
    enabled: true,
    confidence: 1,
    confirmed: '',
    author: 'user',
    locked: true,
  };
}

describe('LibraryTransfer', () => {
  let base: string;
  let source: string;
  let skills: SkillLibrary;
  let persona: PersonaLibrary;
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
    persona = new PersonaLibrary(join(base, 'persona'));
    transfer = new LibraryTransfer(skills, persona);
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
      persona: [],
    });
    expect(result).toEqual({ skills: 2, persona: 0, linksRewritten: 1, error: null });
    expect((await skills.read('alpha'))?.body).toContain('[B](../bravo/SKILL.md)');
    expect(readdirSync(base).sort()).toEqual(['persona', 'skills', 'source']);
  });

  it('commit_whenNameExistsAndNotReplacing_writesNothing', async () => {
    await skills.save({ ...draft('alpha'), body: 'old' });
    write('a.md', '# A\n');
    const plan: SkillImportPlan = await transfer.scan(source);
    const result: SkillImportResult = await transfer.commit({
      planId: plan.id,
      skills: [{ source: 'a.md', draft: draft('alpha'), replace: false }],
      persona: [],
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
      persona: [],
    });
    expect((await skills.read('alpha'))?.body).toBe('new\n');
  });

  it('commit_whenAPersonaEntryFails_rollsBackTheSkillsToo', async () => {
    await skills.save({ ...draft('alpha'), body: 'old' });
    write('a.md', '# A\n');
    const plan: SkillImportPlan = await transfer.scan(source);
    // A folder where the entry file should go makes its write fail after the skills moved in.
    mkdirSync(join(persona.entriesDirectory, 'terse.md'), { recursive: true });
    const result: SkillImportResult = await transfer.commit({
      planId: plan.id,
      skills: [{ source: 'a.md', draft: draft('alpha', 'new'), replace: true }],
      persona: [{ entry: entryOf('terse', 'Terse', 'x'), replace: true }],
    });
    expect(result.error).not.toBeNull();
    expect((await skills.read('alpha'))?.body).toBe('old\n');
    expect(readdirSync(base).sort()).toEqual(['persona', 'skills', 'source']);
  });

  it('commit_whenSourceNotInPlan_refuses', async () => {
    const plan: SkillImportPlan = await transfer.scan(source);
    const result: SkillImportResult = await transfer.commit({
      planId: plan.id,
      skills: [{ source: '../../etc/passwd', draft: draft('x'), replace: false }],
      persona: [],
    });
    expect(result.error).toContain('not part of this import');
  });

  it('export_thenScan_roundTripsSkillsAndThePersona', async () => {
    await skills.save(draft('alpha'));
    writeFileSync(join(base, 'note.txt'), '');
    await persona.save({
      ...entryOf('terse', 'Be: terse', 'Short.'),
      layer: 'memory',
      tags: ['x'],
    });
    const exported: SkillExportResult = await transfer.export(
      base,
      new Date('2026-11-01T12:00:00Z'),
    );
    expect(exported).toMatchObject({ skills: 1, persona: 1, error: null });
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
    expect(plan.persona[0]).toMatchObject({
      id: 'terse',
      name: 'Be: terse',
      text: 'Short.',
      layer: 'memory',
      tags: ['x'],
    });
    expect(plan.existingSkills).toEqual(['alpha']);
    expect(existsSync(join(source))).toBe(true);
  });
});
