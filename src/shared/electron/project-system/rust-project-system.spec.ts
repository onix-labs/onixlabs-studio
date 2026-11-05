import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { ProjectItemNode, ProjectItems, ProjectModel } from '@shared/api/project-system';
import {
  parseCargoPackageName,
  parseCargoWorkspaceMembers,
  RustProjectSystem,
} from './rust-project-system';

describe('parseCargoPackageName', () => {
  it('readsThePackageTableName', () => {
    const toml: string = ['[package]', 'name = "my-crate"', 'version = "0.1.0"'].join('\n');
    expect(parseCargoPackageName(toml)).toBe('my-crate');
  });

  it('returnsNullForAVirtualWorkspaceRootWithNoPackage', () => {
    const toml: string = ['[workspace]', 'members = ["a", "b"]'].join('\n');
    expect(parseCargoPackageName(toml)).toBeNull();
    expect(parseCargoPackageName(null)).toBeNull();
  });

  it('doesNotReadANameFromAnotherTable', () => {
    const toml: string = ['[package]', 'version = "1"', '', '[dependencies]', 'name = "x"'].join(
      '\n',
    );
    expect(parseCargoPackageName(toml)).toBeNull();
  });
});

describe('parseCargoWorkspaceMembers', () => {
  it('readsAMultilineMembersArray', () => {
    const toml: string = [
      '[workspace]',
      'members = [',
      '  "crates/core",',
      '  "crates/cli",',
      ']',
    ].join('\n');
    expect(parseCargoWorkspaceMembers(toml)).toEqual(['crates/core', 'crates/cli']);
  });

  it('readsAnInlineMembersArrayWithWildcards', () => {
    expect(parseCargoWorkspaceMembers('[workspace]\nmembers = ["crates/*"]')).toEqual(['crates/*']);
  });

  it('returnsEmptyWhenAbsent', () => {
    expect(parseCargoWorkspaceMembers(null)).toEqual([]);
    expect(parseCargoWorkspaceMembers('[package]\nname = "x"')).toEqual([]);
  });
});

describe('RustProjectSystem', () => {
  const provider: RustProjectSystem = new RustProjectSystem();

  it('declaresTheRustKindWithDevReleaseAndATargetTripleAxis', () => {
    expect(provider.kind).toBe('rust');
    expect(provider.capabilities.actions).toEqual(['build', 'clean', 'rebuild']);
    expect(
      provider.capabilities.buildConfigurations.map((c: { id: string }): string => c.id),
    ).toEqual(['dev', 'release']);
    expect(provider.capabilities.target?.kind).toBe('target-triple');
    expect(provider.capabilities.debug).toBeNull();
  });

  it('ownsCargoManifestsOnly', () => {
    expect(provider.ownsProject('/w/Cargo.toml')).toBe(true);
    expect(provider.ownsProject('/w/Cargo.lock')).toBe(false);
    expect(provider.ownsProject('/w/main.rs')).toBe(false);
  });
});

const fixtures: string[] = [];

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Writes a tree of files under a new temporary directory.
 * @param files The files' contents, by relative path.
 * @returns Returns the directory.
 */
function fixture(files: Readonly<Record<string, string>>): string {
  const root: string = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-project-')));
  fixtures.push(root);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), content);
  }
  return root;
}

/**
 * Lists the paths of a project tree, folders first.
 * @param nodes The tree.
 * @returns Returns the names, indented by depth.
 */
function names(nodes: readonly ProjectItemNode[], depth: number = 0): string[] {
  return nodes.flatMap((node: ProjectItemNode): string[] => [
    `${' '.repeat(depth)}${node.name}`,
    ...(node.type === 'folder' ? names(node.children, depth + 1) : []),
  ]);
}

describe('RustProjectSystem on disk', () => {
  const provider: RustProjectSystem = new RustProjectSystem();

  it('readsWorkspaceMembers_notDefaultMembers_whichComeFirst', () => {
    expect(
      parseCargoWorkspaceMembers(
        '[workspace]\ndefault-members = ["a"]\nmembers = ["a", "b"]\nexclude = ["c"]',
      ),
    ).toEqual(['a', 'b']);
  });

  it('readsAManifestWithWindowsLineEndings', () => {
    expect(parseCargoPackageName('[package]\r\nname = "crate"\r\n')).toBe('crate');
  });

  it('detectsAManifest_butNotADirectoryOfThatName', async () => {
    expect(await provider.detect(fixture({ 'Cargo.toml': '[package]\nname = "a"' }))).toBe(true);
    expect(await provider.detect(fixture({ 'Cargo.toml/x': '' }))).toBe(false);
    expect(await provider.detect(fixture({}))).toBe(false);
  });

  it('isNull_withNoReadableManifest', async () => {
    expect(await provider.load(fixture({}))).toBeNull();
  });

  it('loadsASingleCrate_namedByItsFolderWhenItHasNoName', async () => {
    const root: string = fixture({ 'Cargo.toml': '# nothing useful' });

    const model: ProjectModel | null = await provider.load(root);

    expect(model?.solution).toBeNull();
    expect(model?.projects).toEqual([
      { name: path.basename(root), path: path.join(root, 'Cargo.toml') },
    ]);
  });

  it('expandsWildcardMembers_skippingWhatHoldsNoManifest', async () => {
    const root: string = fixture({
      'Cargo.toml': '[workspace]\nmembers = ["crates/*", "tools/one", "gone/*", "absent"]',
      'crates/zed/Cargo.toml': '[package]\nname = "zed"',
      'crates/alpha/Cargo.toml': '# unnamed',
      'crates/empty/readme.md': '',
      'crates/file.txt': '',
      'tools/one/Cargo.toml': '[package]\nname = "one"',
    });

    const model: ProjectModel | null = await provider.load(root);

    expect(model?.projects.map((entry: { name: string }): string => entry.name)).toEqual([
      'alpha',
      'one',
      'zed',
    ]);
    expect(model?.solution?.path).toBe(path.join(root, 'Cargo.toml'));
  });

  it('countsARootThatIsBothAPackageAndAWorkspace_asACrateToo', async () => {
    const root: string = fixture({
      'Cargo.toml': '[package]\nname = "root"\n[workspace]\nmembers = ["a"]',
      'a/Cargo.toml': '[package]\nname = "a"',
    });

    const model: ProjectModel | null = await provider.load(root);

    expect(model?.projects.map((entry: { name: string }): string => entry.name)).toEqual([
      'root',
      'a',
    ]);
  });

  it('listsAProjectsItems_foldersFirst_skippingBuildOutputAndDotFolders', async () => {
    const root: string = fixture({
      'Cargo.toml': '',
      'src/main.rs': '',
      'target/debug/app': '',
      '.git/config': '',
      'empty/.keep/x': '',
    });

    const items: ProjectItems | null = await provider.loadProjectItems(
      path.join(root, 'Cargo.toml'),
    );

    expect(names(items?.tree ?? [])).toEqual(['src', ' main.rs', 'Cargo.toml']);
  });

  it('isNull_forItemsOfAProjectWhoseFolderHasGone', async () => {
    expect(await provider.loadProjectItems('/no/such/place/Cargo.toml')).toBeNull();
  });
});
