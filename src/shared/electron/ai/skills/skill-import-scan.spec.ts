import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GLOBAL_SCOPE } from '@shared/api/ai-types';
import type { PromptProfile } from '@shared/api/prompt-profile-channels';
import { SKILL_DESCRIPTION_LIMIT } from '@shared/api/skill-channels';
import { LIBRARY_EXPORT_FORMAT, type SkillImportDraft } from '@shared/api/skill-import-channels';
import {
  classify,
  commonFolder,
  draftDescription,
  rewriteSkillLinks,
  scanForSkills,
  scanProfiles,
  scanSelection,
  type ScannedFolder,
} from './skill-import-scan';

/**
 * A skill in the shape the motivating library uses: no frontmatter, a title, an introduction and a
 * "When to use" section.
 */
const PLAIN_SKILL: string = [
  '# Account Enumeration',
  '',
  'Account enumeration is when an attacker can tell whether an account exists. See [GDPR](gdpr.md).',
  '',
  '## When to use',
  '',
  'Apply this skill whenever you build or review:',
  '',
  '- Login forms and login APIs.',
  '- **Password reset** flows.',
  '',
  '## Core concepts',
  '',
  'x'.repeat(300),
].join('\n');

describe('draftDescription', () => {
  it('draftDescription_whenIntroAndWhenToUse_joinsThem', () => {
    expect(draftDescription(PLAIN_SKILL)).toBe(
      'Account enumeration is when an attacker can tell whether an account exists. See GDPR. Use it when: login forms and login APIs; password reset flows.',
    );
  });

  it('draftDescription_whenNoIntroduction_isEmpty', () => {
    expect(draftDescription('# Title\n\n- just a list\n')).toBe('');
  });

  it('draftDescription_whenTooLong_dropsBulletsThenShortensAtASentence', () => {
    const sentence: string = 'This is a fairly long sentence about the subject. ';
    const body: string = `# T\n\n${sentence.repeat(40)}\n\n## When to use\n\n- a\n`;
    const description: string = draftDescription(body);
    expect(description.length).toBeLessThanOrEqual(SKILL_DESCRIPTION_LIMIT);
    expect(description.endsWith('subject.')).toBe(true);
    expect(description).not.toContain('Use it when');
  });
});

describe('classify', () => {
  const draft: SkillImportDraft = {
    name: 'x',
    description: 'd',
    scope: GLOBAL_SCOPE,
    technologies: [],
    enabled: true,
    body: '',
  };

  it('classify_whenReadme_isNotASkill', () => {
    expect(classify('README.md', 'x'.repeat(500), draft).status).toBe('not-a-skill');
  });

  it('classify_whenAgentInstructions_isNotASkill', () => {
    expect(classify('CLAUDE.md', 'x'.repeat(500), draft).status).toBe('not-a-skill');
  });

  it('classify_whenShort_needsAi', () => {
    expect(classify('acid.md', 'short', draft).status).toBe('needs-ai');
  });

  it('classify_whenNoDescription_needsAi', () => {
    expect(classify('acid.md', 'x'.repeat(500), { ...draft, description: '' }).reason).toContain(
      'introduction',
    );
  });

  it('classify_whenLowercaseSecurity_isASkill', () => {
    expect(classify('security.md', 'x'.repeat(500), draft).status).toBe('ready');
  });
});

describe('rewriteSkillLinks', () => {
  const names: ReadonlyMap<string, string> = new Map([
    ['skills/gdpr.md', 'gdpr'],
    ['skills/clean-code.md', 'clean-code'],
  ]);

  it('rewriteSkillLinks_whenSiblingLink_pointsAtTheImportedFolder', () => {
    expect(rewriteSkillLinks('See [GDPR](gdpr.md#scope).', 'skills/acid.md', names)).toEqual({
      body: 'See [GDPR](../gdpr/SKILL.md#scope).',
      rewritten: 1,
    });
  });

  it('rewriteSkillLinks_whenParentRelativeLink_resolvesIt', () => {
    expect(
      rewriteSkillLinks(
        '[Clean](../../skills/clean-code.md)',
        'house-styles/skills/csharp.md',
        names,
      ).body,
    ).toBe('[Clean](../clean-code/SKILL.md)');
  });

  it('rewriteSkillLinks_whenReferenceDefinition_rewritesIt', () => {
    expect(rewriteSkillLinks('[g]: ./gdpr.md', 'skills/acid.md', names).body).toBe(
      '[g]: ../gdpr/SKILL.md',
    );
  });

  it('rewriteSkillLinks_whenExternalOrUnknown_leavesIt', () => {
    const body: string = '[a](https://x.dev/a.md) [b](#top) [c](missing.md)';
    expect(rewriteSkillLinks(body, 'skills/acid.md', names)).toEqual({ body, rewritten: 0 });
  });
});

describe('scanForSkills', () => {
  let root: string;

  /**
   * Writes a file under the fixture root.
   * @param path The relative path.
   * @param text The contents.
   */
  function write(path: string, text: string): void {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'skill-scan-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('scanForSkills_whenPlainMarkdown_convertsEveryFile', async () => {
    write('README.md', '# Index\n');
    write('skills/account-enumeration.md', PLAIN_SKILL);
    write('skills/.claude/ignored.md', PLAIN_SKILL);
    const found: ScannedFolder = await scanForSkills(root);
    expect(found.kind).toBe('convert');
    expect(found.entries.map((entry) => [entry.source, entry.status])).toEqual([
      ['README.md', 'not-a-skill'],
      ['skills/account-enumeration.md', 'ready'],
    ]);
    expect(found.entries[1].draft.name).toBe('account-enumeration');
  });

  it('scanForSkills_whenNestedSkillFolder_isOneCandidateWithItsFiles', async () => {
    write('pack/pdf/SKILL.md', '---\nname: pdf\ndescription: Reads PDFs.\n---\n# PDF\n');
    write('pack/pdf/reference.md', PLAIN_SKILL);
    const found: ScannedFolder = await scanForSkills(root);
    expect(found.entries).toHaveLength(1);
    expect(found.entries[0].source).toBe('pack/pdf/SKILL.md');
    expect(found.entries[0].bundled).toEqual(['reference.md']);
  });

  it('scanForSkills_whenFolderOfSkillFolders_restores', async () => {
    write('alpha/SKILL.md', '---\nname: alpha\ndescription: A.\n---\nBody\n');
    const found: ScannedFolder = await scanForSkills(root);
    expect(found.kind).toBe('restore');
    expect(found.entries[0]).toMatchObject({ source: 'alpha/SKILL.md', status: 'ready' });
  });

  it('scanForSkills_whenExport_readsSkillsAndProfiles', async () => {
    write('manifest.json', JSON.stringify({ format: LIBRARY_EXPORT_FORMAT, version: 1 }));
    write('skills/alpha/SKILL.md', '---\nname: alpha\ndescription: A.\n---\nBody\n');
    write('profiles/terse.md', '---\nname: "Be terse"\nenabled: false\n---\nShort answers.\n');
    const found: ScannedFolder = await scanForSkills(root);
    expect(found.kind).toBe('restore');
    expect(found.entries[0].source).toBe('skills/alpha/SKILL.md');
    expect(found.profiles).toEqual([
      {
        id: 'terse',
        name: 'Be terse',
        scope: GLOBAL_SCOPE,
        instructions: 'Short answers.',
        enabled: false,
      },
    ]);
  });

  it('scanForSkills_whenSingleFile_convertsJustThatFile', async () => {
    write('one.md', PLAIN_SKILL);
    write('two.md', PLAIN_SKILL);
    const found: ScannedFolder = await scanForSkills(join(root, 'one.md'));
    expect(found.entries.map((entry) => entry.source)).toEqual(['one.md']);
  });

  it('scanSelection_whenSeveralFiles_sourcesAreRelativeToTheirSharedFolder', async () => {
    write('skills/gdpr.md', PLAIN_SKILL);
    write('house-styles/skills/csharp.md', PLAIN_SKILL);
    write('skills/ignored.md', PLAIN_SKILL);
    const found: ScannedFolder = await scanSelection([
      join(root, 'skills/gdpr.md'),
      join(root, 'house-styles/skills/csharp.md'),
    ]);
    expect(found.kind).toBe('convert');
    expect(found.entries.map((entry) => entry.source)).toEqual([
      'house-styles/skills/csharp.md',
      'skills/gdpr.md',
    ]);
  });

  it('scanSelection_whenFileAndFolderOverlap_listsEachFileOnce', async () => {
    write('skills/gdpr.md', PLAIN_SKILL);
    write('skills/acid.md', PLAIN_SKILL);
    write('pack/pdf/SKILL.md', '---\nname: pdf\ndescription: Reads PDFs.\n---\n# PDF\n');
    const found: ScannedFolder = await scanSelection([
      join(root, 'skills'),
      join(root, 'skills/gdpr.md'),
      join(root, 'pack/pdf'),
    ]);
    expect(found.entries.map((entry) => entry.source)).toEqual([
      'pack/pdf/SKILL.md',
      'skills/acid.md',
      'skills/gdpr.md',
    ]);
  });
});

describe('scanProfiles', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'profile-scan-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('scanProfiles_whenMarkdownAndExport_namesEachAndKeepsIdsUnique', async () => {
    mkdirSync(join(root, 'mine'));
    writeFileSync(join(root, 'mine/README.md'), '# Index\n');
    writeFileSync(join(root, 'mine/terse.md'), '# Be Terse\n\nShort answers.\n');
    writeFileSync(join(root, 'mine/plain.md'), 'No heading here.\n');
    writeFileSync(join(root, 'mine/empty.md'), '');
    mkdirSync(join(root, 'export/profiles'), { recursive: true });
    writeFileSync(
      join(root, 'export/manifest.json'),
      JSON.stringify({ format: LIBRARY_EXPORT_FORMAT }),
    );
    writeFileSync(join(root, 'export/profiles/be-terse.md'), '---\nname: "Be Terse"\n---\nOld.\n');
    const profiles: readonly PromptProfile[] = await scanProfiles([
      join(root, 'mine'),
      join(root, 'export'),
    ]);
    expect(profiles.map((profile) => [profile.id, profile.name])).toEqual([
      ['be-terse', 'Be Terse'],
      ['plain', 'plain'],
      ['be-terse-2', 'Be Terse'],
    ]);
    expect(profiles[2].instructions).toBe('# Be Terse\n\nShort answers.');
  });
});

describe('commonFolder', () => {
  it('commonFolder_whenSiblingTrees_isTheirSharedParent', () => {
    expect(commonFolder(['/a/b/c.md', '/a/d/e/f.md'])).toBe('/a');
    expect(commonFolder(['/a/b/c.md', '/a/b/d.md'])).toBe('/a/b');
    expect(commonFolder(['/x.md', '/y/z.md'])).toBe('/');
  });
});
