import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Skill, SkillSaveResult } from '@shared/api/skill-channels';
import type { OfferedSkill } from '../agent-provider';
import { SkillLibrary } from './skill-library';

/**
 * Writes a skill folder by hand, as a user editing on disk would.
 * @param root The library root.
 * @param name The folder name.
 * @param text The SKILL.md text.
 * @param files Extra files to bundle, by relative path.
 */
function writeSkill(
  root: string,
  name: string,
  text: string,
  files: Readonly<Record<string, string>> = {},
): void {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, 'SKILL.md'), text, 'utf8');
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(root, name, file, '..'), { recursive: true });
    writeFileSync(join(root, name, file), content, 'utf8');
  }
}

describe('SkillLibrary', () => {
  let root: string;
  let library: SkillLibrary;

  beforeEach(() => {
    root = join(mkdtempSync(join(tmpdir(), 'skills-')), 'library');
    library = new SkillLibrary(root);
  });

  afterEach(() => {
    rmSync(join(root, '..'), { recursive: true, force: true });
  });

  it('list_whenLibraryMissing_isEmpty', async () => {
    expect(await library.list()).toEqual([]);
  });

  it('list_readsEveryFolderSortedByNameAndReportsProblems', async () => {
    writeSkill(root, 'zeta', '---\nname: zeta\ndescription: Z.\n---\nbody');
    writeSkill(root, 'alpha', '---\nname: alpha\n---\nno description');
    writeSkill(root, 'Bad Name', '---\nname: x\ndescription: d\n---\n');
    mkdirSync(join(root, 'not-a-skill'));

    const skills: readonly Skill[] = await library.list();

    expect(skills.map((skill: Skill): string => skill.name)).toEqual(['alpha', 'zeta']);
    expect(skills[0].problem).toContain('no description');
    expect(skills[1].problem).toBeNull();
    expect(skills[1].body).toBe('body');
  });

  it('read_listsBundledFilesRelativeToTheFolder', async () => {
    writeSkill(root, 'a', '---\nname: a\ndescription: d\n---\n', {
      'notes.md': 'n',
      'scripts/run.sh': 'echo',
    });

    const skill: Skill | null = await library.read('a');

    expect(skill?.files).toEqual(['notes.md', join('scripts', 'run.sh')]);
  });

  it('save_whenNew_createsTheFolderAndFile', async () => {
    const result: SkillSaveResult = await library.save({
      name: 'Commit-Message',
      description: 'How to write a commit.',
      scope: { surfaces: ['project'], languages: [] },
      enabled: true,
      body: 'Subject, blank, body.',
    });

    expect(result.error).toBeNull();
    expect(result.skill?.name).toBe('commit-message');
    expect(existsSync(join(root, 'commit-message', 'SKILL.md'))).toBe(true);
    expect((await library.read('commit-message'))?.scope.surfaces).toEqual(['project']);
  });

  it('save_whenRenamed_movesTheFolderAndKeepsBundledFiles', async () => {
    writeSkill(root, 'old', '---\nname: old\ndescription: d\n---\nbody', { 'x.txt': 'x' });

    const result: SkillSaveResult = await library.save({
      name: 'new',
      previousName: 'old',
      description: 'd',
      scope: { surfaces: [], languages: [] },
      enabled: true,
      body: 'body',
    });

    expect(result.error).toBeNull();
    expect(existsSync(join(root, 'old'))).toBe(false);
    expect(existsSync(join(root, 'new', 'x.txt'))).toBe(true);
  });

  it('save_whenRenamedOntoAnExistingSkill_refuses', async () => {
    writeSkill(root, 'a', '---\nname: a\ndescription: d\n---\n');
    writeSkill(root, 'b', '---\nname: b\ndescription: d\n---\n');

    const result: SkillSaveResult = await library.save({
      name: 'b',
      previousName: 'a',
      description: 'd',
      scope: { surfaces: [], languages: [] },
      enabled: true,
      body: '',
    });

    expect(result.error).toContain('already exists');
    expect(existsSync(join(root, 'a'))).toBe(true);
  });

  it('save_keepsFrontmatterKeysItDoesNotOwn', async () => {
    writeSkill(root, 'a', '---\nname: a\ndescription: d\nallowed-tools: Bash\n---\nbody');

    await library.save({
      name: 'a',
      description: 'changed',
      scope: { surfaces: [], languages: [] },
      enabled: false,
      body: 'body',
    });

    const text: string = readFileSync(join(root, 'a', 'SKILL.md'), 'utf8');
    expect(text).toContain('allowed-tools: Bash');
    expect(text).toContain('description: "changed"');
    expect(text).toContain('enabled: false');
  });

  it('save_whenNameInvalid_refusesWithoutWriting', async () => {
    const result: SkillSaveResult = await library.save({
      name: '../escape',
      description: 'd',
      scope: { surfaces: [], languages: [] },
      enabled: true,
      body: '',
    });

    expect(result.skill).toBeNull();
    expect(result.error).toContain('lower-case');
    expect(existsSync(root)).toBe(false);
  });

  it('delete_removesTheFolderAndIgnoresUnsafeNames', async () => {
    writeSkill(root, 'a', '---\nname: a\ndescription: d\n---\n');

    await library.delete('../..');
    await library.delete('a');

    expect(existsSync(join(root, 'a'))).toBe(false);
    expect(existsSync(root)).toBe(true);
  });

  it('import_copiesAFolderIntoTheLibraryUnderItsFrontmatterName', async () => {
    const elsewhere: string = join(root, '..', 'elsewhere');
    writeSkill(elsewhere, 'folder-name', '---\nname: frontmatter-name\ndescription: d\n---\nbody', {
      'extra.md': 'e',
    });

    const result: SkillSaveResult = await library.import(
      join(elsewhere, 'folder-name', 'SKILL.md'),
    );

    expect(result.error).toBeNull();
    expect(result.skill?.name).toBe('frontmatter-name');
    expect(existsSync(join(root, 'frontmatter-name', 'extra.md'))).toBe(true);
  });

  it('import_whenNoSkillFile_refuses', async () => {
    const result: SkillSaveResult = await library.import(join(root, '..'));

    expect(result.error).toContain('No SKILL.md');
  });

  it('offer_returnsOnlyEnabledValidSkillsInScopeWithALoaderThatReadsTheDisk', async () => {
    writeSkill(
      root,
      'csharp',
      '---\nname: csharp\ndescription: C#.\nlanguages: [csharp]\n---\nC# body',
      {
        'ref.md': 'r',
      },
    );
    writeSkill(root, 'everywhere', '---\nname: everywhere\ndescription: All.\n---\nAll body');
    writeSkill(root, 'parked', '---\nname: parked\ndescription: P.\nenabled: false\n---\n');
    writeSkill(root, 'broken', '---\nname: broken\n---\n');
    writeSkill(
      root,
      'terminal',
      '---\nname: terminal\ndescription: T.\nsurfaces: [terminal]\n---\n',
    );

    const offered: readonly OfferedSkill[] = await library.offer('editor', 'csharp');

    expect(offered.map((skill: OfferedSkill): string => skill.name)).toEqual([
      'csharp',
      'everywhere',
    ]);
    const loaded: { body: string; files: readonly string[] } | null = await offered[0].load();
    expect(loaded?.body).toBe('C# body');
    expect(loaded?.files).toEqual([join(root, 'csharp', 'ref.md')]);
  });

  it('offer_load_whenSkillDeletedMeanwhile_returnsNull', async () => {
    writeSkill(root, 'gone', '---\nname: gone\ndescription: G.\n---\n');
    const offered: readonly OfferedSkill[] = await library.offer('project', null);

    await library.delete('gone');

    expect(await offered[0].load()).toBeNull();
  });
});
