import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  normaliseName,
  parseRequirement,
  ReadText,
  readRequirementsFile,
  Requirement,
  RequirementsFile,
} from './requirements';

/**
 * Builds a reader over files held in memory.
 * @param files The files, by absolute path.
 * @returns Returns the reader.
 */
function memory(files: Record<string, string>): ReadText {
  return (filePath: string): Promise<string | null> => Promise.resolve(files[filePath] ?? null);
}

describe('normaliseName', () => {
  it('normaliseName_mixedCaseAndSeparators_isOneName', () => {
    // Act
    const names: readonly string[] = ['Foo_Bar', 'foo.bar', 'FOO--bar'].map(normaliseName);

    // Assert
    expect(new Set<string>(names)).toEqual(new Set<string>(['foo-bar']));
  });
});

describe('parseRequirement', () => {
  it.each<[string, Requirement | null]>([
    ['requests', { name: 'requests', requested: '*', kind: 'index' }],
    ['requests[socks] >= 2.31, < 3', { name: 'requests', requested: '>=2.31,<3', kind: 'index' }],
    ['rich (>=13)', { name: 'rich', requested: '>=13', kind: 'index' }],
    ['tomli; python_version < "3.11"', { name: 'tomli', requested: '*', kind: 'index' }],
    [
      'attrs==23.1.0;python_version>="3.8"',
      { name: 'attrs', requested: '==23.1.0', kind: 'index' },
    ],
    [
      'demo @ https://user:secret@example.com/demo.whl',
      { name: 'demo', requested: 'direct reference', kind: 'direct' },
    ],
    ['not a requirement', null],
    ['-e .', null],
  ])('parseRequirement_%s', (text: string, expected: Requirement | null) => {
    // Act
    const requirement: Requirement | null = parseRequirement(text);

    // Assert
    expect(requirement).toEqual(expected);
  });
});

describe('readRequirementsFile', () => {
  const root: string = path.resolve('/work');

  it('readRequirementsFile_optionsEditablesUrlsAndPaths_areSkippedAndCounted', async () => {
    // Arrange
    const file: string = path.join(root, 'requirements.txt');
    const read: ReadText = memory({
      [file]: [
        '# a comment',
        '--index-url https://user:secret@private.example/simple',
        '-c constraints.txt',
        'requests==2.31.0 --hash=sha256:abc \\',
        '    --hash=sha256:def',
        'rich>=13 # trailing comment',
        '-e .',
        'git+https://github.com/a/b.git#egg=b',
        './local/package',
        'https://example.com/pkg-1.0.tar.gz',
        'pkg @ https://example.com/pkg.whl',
      ].join('\n'),
    });

    // Act
    const result: RequirementsFile | null = await readRequirementsFile(file, root, read);

    // Assert
    expect(result?.requirements).toEqual([
      { name: 'requests', requested: '==2.31.0', kind: 'index' },
      { name: 'rich', requested: '>=13', kind: 'index' },
      { name: 'pkg', requested: 'direct reference', kind: 'direct' },
    ]);
    expect(result?.skipped).toBe(4);
  });

  it('readRequirementsFile_includes_areFollowedOnceAndConfinedToTheRoot', async () => {
    // Arrange
    const dev: string = path.join(root, 'requirements-dev.txt');
    const base: string = path.join(root, 'requirements', 'base.txt');
    const outside: string = path.resolve('/elsewhere/secret.txt');
    const read: ReadText = memory({
      [dev]: ['-r requirements/base.txt', '--requirement=../elsewhere/secret.txt', 'pytest'].join(
        '\n',
      ),
      [base]: ['-r ../requirements-dev.txt', 'django>=5'].join('\n'),
      [outside]: 'should-not-be-read',
    });

    // Act
    const result: RequirementsFile | null = await readRequirementsFile(dev, root, read);

    // Assert
    expect(
      result?.requirements.map((requirement: Requirement): string => requirement.name),
    ).toEqual(['django', 'pytest']);
  });

  it('readRequirementsFile_aFileThatCannotBeRead_answersNull', async () => {
    // Act
    const result: RequirementsFile | null = await readRequirementsFile(
      path.join(root, 'nope.txt'),
      root,
      memory({}),
    );

    // Assert
    expect(result).toBeNull();
  });
});
