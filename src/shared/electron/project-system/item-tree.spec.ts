import * as path from 'node:path';
import { ProjectItemNode } from '@shared/api/project-system';
import { buildItemTree, EvaluatedItem } from './item-tree';

/**
 * The project every case is built against.
 */
const PROJECT: string = path.join('/root', 'A', 'A.csproj');

/**
 * Builds an evaluated item.
 * @param identity The item's path relative to the project.
 * @param link The logical location the item is placed at, when it has one.
 * @returns Returns the item.
 */
function item(identity: string, link: string = ''): EvaluatedItem {
  return { identity, link };
}

/**
 * Finds a folder node by name among a run of nodes.
 * @param nodes The nodes to search.
 * @param name The folder name.
 * @returns Returns the folder node.
 */
function folder(
  nodes: readonly ProjectItemNode[],
  name: string,
): Extract<ProjectItemNode, { type: 'folder' }> {
  const found: ProjectItemNode | undefined = nodes.find(
    (node: ProjectItemNode): boolean => node.type === 'folder' && node.name === name,
  );
  if (found?.type !== 'folder') {
    throw new Error(`No folder named '${name}'.`);
  }
  return found;
}

describe('buildItemTree', () => {
  it('aFolderFromAnItemIdentity_carriesTheDirectoryItStandsFor', () => {
    const tree: readonly ProjectItemNode[] = buildItemTree(PROJECT, [item('Sub/f.cs')]);

    expect(folder(tree, 'Sub').path).toBe(path.join('/root', 'A', 'Sub'));
  });

  it('nestedFoldersFromAnItemIdentity_eachCarryTheirOwnDirectory', () => {
    const tree: readonly ProjectItemNode[] = buildItemTree(PROJECT, [item('Sub/Deep/f.cs')]);

    const sub: Extract<ProjectItemNode, { type: 'folder' }> = folder(tree, 'Sub');
    expect(sub.path).toBe(path.join('/root', 'A', 'Sub'));
    // Each level reports its own directory, not the project's and not its parent's.
    expect(folder(sub.children, 'Deep').path).toBe(path.join('/root', 'A', 'Sub', 'Deep'));
  });

  it('aFolderConjuredByLinkMetadata_carriesNoDirectory', () => {
    // The file lives outside the project and Link places it under a folder that was never a directory.
    // Inferring one from the child would name a directory that does not exist.
    const tree: readonly ProjectItemNode[] = buildItemTree(PROJECT, [
      item('../Shared/f.cs', 'Linked/f.cs'),
    ]);

    expect(folder(tree, 'Linked').path).toBeNull();
    expect(folder(tree, 'Linked').children).toEqual([
      { type: 'file', name: 'f.cs', path: path.resolve('/root', 'Shared', 'f.cs') },
    ]);
  });

  it('aFolderHoldingBothARealAndALinkedFile_reportsTheRealDirectory', () => {
    const tree: readonly ProjectItemNode[] = buildItemTree(PROJECT, [
      item('Sub/real.cs'),
      item('../Shared/linked.cs', 'Sub/linked.cs'),
    ]);

    expect(folder(tree, 'Sub').path).toBe(path.join('/root', 'A', 'Sub'));
  });

  it('aFolderHoldingALinkedFileFirst_stillReportsTheRealDirectory', () => {
    // Real wins over linked in either order, so the answer does not depend on item ordering.
    const tree: readonly ProjectItemNode[] = buildItemTree(PROJECT, [
      item('../Shared/linked.cs', 'Sub/linked.cs'),
      item('Sub/real.cs'),
    ]);

    expect(folder(tree, 'Sub').path).toBe(path.join('/root', 'A', 'Sub'));
  });

  it('aFolderBeneathALinkedFolder_carriesNoDirectoryEither', () => {
    const tree: readonly ProjectItemNode[] = buildItemTree(PROJECT, [
      item('../Shared/f.cs', 'Linked/Deep/f.cs'),
    ]);

    const linked: Extract<ProjectItemNode, { type: 'folder' }> = folder(tree, 'Linked');
    expect(linked.path).toBeNull();
    // Null descends: nothing under a folder that has no directory can have one either.
    expect(folder(linked.children, 'Deep').path).toBeNull();
  });

  it('aFileClimbingOutWithNoLink_isPlacedAtTheRootAndMakesNoFolder', () => {
    const tree: readonly ProjectItemNode[] = buildItemTree(PROJECT, [item('../Shared/f.cs')]);

    expect(tree).toEqual([
      { type: 'file', name: 'f.cs', path: path.resolve('/root', 'Shared', 'f.cs') },
    ]);
  });

  it('aBackslashSeparatedIdentity_isSplitIntoTheSameFolders', () => {
    // MSBuild emits Windows separators; the tree and its paths must not depend on which it used.
    const tree: readonly ProjectItemNode[] = buildItemTree(PROJECT, [item('Sub\\f.cs')]);

    expect(folder(tree, 'Sub').path).toBe(path.join('/root', 'A', 'Sub'));
  });

  it('theSameLogicalPathTwice_isPlacedOnlyOnce', () => {
    const tree: readonly ProjectItemNode[] = buildItemTree(PROJECT, [
      item('Sub/f.cs'),
      item('Sub/f.cs'),
    ]);

    expect(folder(tree, 'Sub').children.length).toBe(1);
  });

  it('aMixOfFoldersAndFiles_sortsFoldersFirstThenEachAlphabetically', () => {
    const tree: readonly ProjectItemNode[] = buildItemTree(PROJECT, [
      item('b.cs'),
      item('Zed/z.cs'),
      item('a.cs'),
      item('Alpha/a.cs'),
    ]);

    expect(tree.map((node: ProjectItemNode): string => node.name)).toEqual([
      'Alpha',
      'Zed',
      'a.cs',
      'b.cs',
    ]);
  });

  it('noItems_buildsAnEmptyTree', () => {
    expect(buildItemTree(PROJECT, [])).toEqual([]);
  });
});
