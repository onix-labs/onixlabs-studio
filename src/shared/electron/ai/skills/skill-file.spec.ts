import { describe, expect, it } from 'vitest';
import { ParsedSkillFile, parseSkillFile, serializeSkillFile, skillProblem } from './skill-file';

describe('parseSkillFile', () => {
  it('parseSkillFile_whenBlockLists_readsNameDescriptionScopeAndBody', () => {
    const text: string = [
      '---',
      'name: csharp-style',
      'description: "House style: explicit types."',
      'surfaces:',
      '  - editor',
      'languages:',
      '  - csharp',
      '  - CSharp',
      'enabled: false',
      '---',
      '# Style',
      '',
      'Prefer explicit types.',
      '',
    ].join('\n');

    const parsed: ParsedSkillFile = parseSkillFile(text);

    expect(parsed.name).toBe('csharp-style');
    expect(parsed.description).toBe('House style: explicit types.');
    expect(parsed.scope).toEqual({ surfaces: ['editor'], languages: ['csharp'] });
    expect(parsed.enabled).toBe(false);
    expect(parsed.body).toBe('# Style\n\nPrefer explicit types.\n');
  });

  it('parseSkillFile_whenInlineLists_readsThem', () => {
    const parsed: ParsedSkillFile = parseSkillFile(
      "---\nname: a\ndescription: 'quoted'\nsurfaces: [terminal, binary]\n---\nbody",
    );

    expect(parsed.scope.surfaces).toEqual(['terminal', 'binary']);
    expect(parsed.description).toBe('quoted');
  });

  it('parseSkillFile_whenNoFrontmatter_isAllBody', () => {
    const parsed: ParsedSkillFile = parseSkillFile('just text');

    expect(parsed.name).toBeNull();
    expect(parsed.description).toBe('');
    expect(parsed.enabled).toBe(true);
    expect(parsed.body).toBe('just text');
  });

  it('parseSkillFile_whenClosingFenceMissing_isAllBody', () => {
    const parsed: ParsedSkillFile = parseSkillFile('---\nname: a\nno end');

    expect(parsed.name).toBeNull();
    expect(parsed.body).toBe('---\nname: a\nno end');
  });

  it('parseSkillFile_keepsForeignKeysAsLines', () => {
    const parsed: ParsedSkillFile = parseSkillFile(
      '---\nname: a\nallowed-tools:\n  - Bash\n# a comment\nmodel: opus\ndescription: d\n---\n',
    );

    expect(parsed.foreignLines).toEqual([
      'allowed-tools:',
      '  - Bash',
      '# a comment',
      'model: opus',
    ]);
  });

  it('parseSkillFile_treatsWindowsLineEndingsAsNewlines', () => {
    const parsed: ParsedSkillFile = parseSkillFile(
      '---\r\nname: a\r\ndescription: d\r\n---\r\nbody\r\n',
    );

    expect(parsed.name).toBe('a');
    expect(parsed.body).toBe('body\n');
  });
});

describe('serializeSkillFile', () => {
  it('serializeSkillFile_roundTripsThroughParse', () => {
    const text: string = serializeSkillFile({
      name: 'commit-message',
      description: 'How to write: a commit # message',
      scope: { surfaces: ['editor', 'project'], languages: [] },
      enabled: true,
      body: 'Subject line, blank line, body.\n\n\n',
      foreignLines: ['model: opus'],
    });

    const parsed: ParsedSkillFile = parseSkillFile(text);

    expect(parsed.name).toBe('commit-message');
    expect(parsed.description).toBe('How to write: a commit # message');
    expect(parsed.scope).toEqual({ surfaces: ['editor', 'project'], languages: [] });
    expect(parsed.enabled).toBe(true);
    expect(parsed.body).toBe('Subject line, blank line, body.\n');
    expect(parsed.foreignLines).toEqual(['model: opus']);
    expect(text).toContain('languages: []');
  });
});

describe('skillProblem', () => {
  it('skillProblem_whenValid_returnsNull', () => {
    expect(skillProblem('csharp-style', 'A description.')).toBeNull();
  });

  it('skillProblem_whenNameMissingOrInvalid_saysSo', () => {
    expect(skillProblem(null, 'd')).toContain('no name');
    expect(skillProblem('Bad Name', 'd')).toContain('lower-case');
    expect(skillProblem('../escape', 'd')).toContain('lower-case');
  });

  it('skillProblem_whenDescriptionMissingOrTooLong_saysSo', () => {
    expect(skillProblem('ok', '')).toContain('no description');
    expect(skillProblem('ok', 'x'.repeat(2000))).toContain('longer than');
  });
});
