import {
  normaliseFolderPath,
  renameSolutionFolder,
  SolutionFolderRename,
} from './solution-folders';

/**
 * A solution declaring a folder, a nested folder beneath it, a sibling, and projects in each.
 */
const SLNX: string = `<Solution>
  <!-- The core of the product. -->
  <Folder Name="/Core/">
    <Project Path="src/Core/Core.csproj" />
  </Folder>
  <Folder Name="/Core/Abstractions/">
    <Project Path="src/Core.Abstractions/Core.Abstractions.csproj" />
  </Folder>
  <Folder Name="/Tests/">
    <Project Path="tests/Core.Tests/Core.Tests.csproj" />
  </Folder>
</Solution>
`;

/**
 * Renames within the sample solution and returns the rewritten content, failing the call when the
 * rename was refused.
 * @param folderPath The folder to rename.
 * @param name The new name.
 * @returns Returns the rewritten content.
 */
function rename(folderPath: string, name: string): string {
  const result: SolutionFolderRename = renameSolutionFolder(SLNX, folderPath, name);
  if (!result.ok) {
    throw new Error(`Expected a rewrite, got: ${result.error}`);
  }
  return result.content;
}

/**
 * Renames within the sample solution and returns the refusal, failing the call when it was allowed.
 * @param folderPath The folder to rename.
 * @param name The new name.
 * @returns Returns the refusal message.
 */
function refusal(folderPath: string, name: string): string {
  const result: SolutionFolderRename = renameSolutionFolder(SLNX, folderPath, name);
  if (result.ok) {
    throw new Error('Expected a refusal.');
  }
  return result.error;
}

describe('normaliseFolderPath', () => {
  it('bringsEveryWrittenStyleToOneForm', () => {
    expect(normaliseFolderPath('/Core/')).toBe('/Core');
    expect(normaliseFolderPath('Core')).toBe('/Core');
    expect(normaliseFolderPath('\\Core\\Abstractions\\')).toBe('/Core/Abstractions');
  });

  it('namesNoFolderForAnEmptyOrRootPath', () => {
    expect(normaliseFolderPath('')).toBe('');
    expect(normaliseFolderPath('/')).toBe('');
  });
});

describe('renameSolutionFolder', () => {
  it('rewritesTheFoldersOwnName', () => {
    expect(rename('/Tests', 'Testing')).toContain('<Folder Name="/Testing/">');
    expect(rename('/Tests', 'Testing')).not.toContain('<Folder Name="/Tests/">');
  });

  it('rewritesEveryDescendantsPrefix', () => {
    // .slnx encodes nesting in the Name path, so a descendant declared flat carries the old prefix and
    // would be orphaned into a new top-level folder if it were left alone.
    const content: string = rename('/Core', 'Kernel');

    expect(content).toContain('<Folder Name="/Kernel/">');
    expect(content).toContain('<Folder Name="/Kernel/Abstractions/">');
    expect(content).not.toContain('<Folder Name="/Core');
  });

  it('leavesProjectPathsAlone', () => {
    // A Project Path is a filesystem path; renaming a logical grouping must not touch a file on disk.
    const content: string = rename('/Core', 'Kernel');

    expect(content).toContain('<Project Path="src/Core/Core.csproj" />');
    expect(content).toContain('<Project Path="src/Core.Abstractions/Core.Abstractions.csproj" />');
  });

  it('leavesUnrelatedFoldersAndCommentsAlone', () => {
    const content: string = rename('/Core', 'Kernel');

    expect(content).toContain('<Folder Name="/Tests/">');
    expect(content).toContain('<!-- The core of the product. -->');
  });

  it('renamingANestedFolder_leavesItsParentAlone', () => {
    const content: string = rename('/Core/Abstractions', 'Contracts');

    expect(content).toContain('<Folder Name="/Core/Contracts/">');
    expect(content).toContain('<Folder Name="/Core/">');
  });

  it('refusesANameAlreadyTakenBySibling', () => {
    // The parser reuses a segment already created, so two folders sharing a path read back as one
    // node — an unchecked rename would silently fuse them, and there is no undo.
    expect(refusal('/Core', 'Tests')).toContain('already here');
  });

  it('refusesANameAlreadyTakenBySiblingWithinAParent', () => {
    const withSibling: string = SLNX.replace(
      '<Folder Name="/Tests/">',
      '<Folder Name="/Core/Contracts/" />\n  <Folder Name="/Tests/">',
    );
    const result: SolutionFolderRename = renameSolutionFolder(
      withSibling,
      '/Core/Abstractions',
      'Contracts',
    );

    expect(result.ok).toBe(false);
  });

  it('refusesANameBearingAPathSeparator', () => {
    expect(refusal('/Core', 'Core/Deep')).toContain('path separator');
    expect(refusal('/Core', 'Core\\Deep')).toContain('path separator');
  });

  it('refusesAnEmptyOrWhitespaceName', () => {
    expect(refusal('/Core', '')).toContain('cannot be empty');
    expect(refusal('/Core', '   ')).toContain('cannot be empty');
  });

  it('refusesAFolderTheSolutionDoesNotDeclare', () => {
    expect(refusal('/Missing', 'Anything')).toContain('no folder');
  });

  it('refusesWhenNoFolderIsNamed', () => {
    expect(refusal('/', 'Anything')).toContain('No folder');
  });

  it('renamingToTheSameName_changesNothing', () => {
    expect(rename('/Core', 'Core')).toBe(SLNX);
  });

  it('trimsTheNameBeforeWritingIt', () => {
    expect(rename('/Tests', '  Testing  ')).toContain('<Folder Name="/Testing/">');
  });

  it('preservesADeclarationsOwnSlashStyle', () => {
    // The file is the user's to keep as they wrote it; a rename is not the moment to reformat it.
    const terse: string =
      '<Solution><Folder Name="Core"><Project Path="a.csproj" /></Folder></Solution>';
    const result: SolutionFolderRename = renameSolutionFolder(terse, '/Core', 'Kernel');

    expect(result.ok).toBe(true);
    expect(result.ok && result.content).toContain('<Folder Name="Kernel">');
  });

  it('rewritesAFolderWhoseNameIsNotItsFirstAttribute', () => {
    const attributed: string = '<Solution><Folder Type="x" Name="/Core/" /></Solution>';
    const result: SolutionFolderRename = renameSolutionFolder(attributed, '/Core', 'Kernel');

    expect(result.ok && result.content).toContain('<Folder Type="x" Name="/Kernel/" />');
  });

  it('doesNotRewriteAFolderThatMerelySharesAPrefix', () => {
    // '/CoreExtras' starts with '/Core' as a string but is not beneath it.
    const near: string =
      '<Solution><Folder Name="/Core/" /><Folder Name="/CoreExtras/" /></Solution>';
    const result: SolutionFolderRename = renameSolutionFolder(near, '/Core', 'Kernel');

    expect(result.ok && result.content).toContain('<Folder Name="/CoreExtras/" />');
    expect(result.ok && result.content).toContain('<Folder Name="/Kernel/" />');
  });
});
