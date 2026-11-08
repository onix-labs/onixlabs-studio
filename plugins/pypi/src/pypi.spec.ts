import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  HttpFetch,
  HttpResponse,
  InstalledPackage,
  PackageManagerModel,
  PackageProject,
  PackageSearchResult,
} from './protocol';
import { PypiPackageManager, PythonProject } from './pypi';

/**
 * Builds a fetch that answers PyPI's JSON API from a table of latest versions, and records each URL.
 * @param latest The latest version by normalised name.
 * @param urls Collects the URLs asked for.
 * @returns Returns the fetch.
 */
function fakePypi(latest: Record<string, string>, urls: string[] = []): HttpFetch {
  return (url: string): Promise<HttpResponse> => {
    urls.push(url);
    const name: string = /\/pypi\/([^/]+)\/json$/.exec(url)?.[1] ?? '';
    const version: string | undefined = latest[name];
    const body: unknown =
      version === undefined
        ? null
        : {
            info: { name, version, summary: `${name} summary` },
            releases: { [version]: [{ yanked: false }] },
          };
    return Promise.resolve({
      ok: body !== null,
      status: body === null ? 404 : 200,
      json: (): Promise<unknown> => Promise.resolve(body),
    });
  };
}

/**
 * Writes a file, making its folder.
 * @param filePath The path.
 * @param text The content.
 */
function write(filePath: string, text: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, text);
}

/**
 * Reads a project's packages as `name installed latest status scope`.
 * @param project The project.
 * @returns Returns the rows.
 */
function rows(project: PackageProject | undefined): readonly string[] {
  return (project?.packages ?? []).map(
    (entry: InstalledPackage): string =>
      `${entry.name} ${entry.installed} ${entry.latest} ${entry.status} ${entry.scope}`,
  );
}

describe('PypiPackageManager', () => {
  let root: string = '';
  let manager: PypiPackageManager;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-pypi-')));
    // ⛔ The user's own pip.conf has no place in a spec.
    vi.stubEnv('HOME', path.join(root, 'home'));
    vi.stubEnv('USERPROFILE', path.join(root, 'home'));
    manager = new PypiPackageManager(() => Promise.resolve(null), {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('load_aFolderWithNoPythonProject_answersNull', async () => {
    // Arrange
    write(path.join(root, 'package.json'), '{}');

    // Act
    const model: PackageManagerModel | null = await manager.load(root, fakePypi({}));

    // Assert
    expect(model).toBeNull();
  });

  it('load_aUvProject_readsInstalledFromUvLock_andLatestFromPypi', async () => {
    // Arrange
    write(
      path.join(root, 'pyproject.toml'),
      [
        '[project]',
        'name = "app"',
        'dependencies = ["Requests>=2", "local @ file:///x"]',
        '[dependency-groups]',
        'dev = ["pytest"]',
      ].join('\n'),
    );
    write(
      path.join(root, 'uv.lock'),
      [
        '[[package]]',
        'name = "requests"',
        'version = "2.31.0"',
        '[[package]]',
        'name = "pytest"',
        'version = "8.3.0"',
      ].join('\n'),
    );
    const urls: string[] = [];

    // Act
    const model: PackageManagerModel | null = await manager.load(
      root,
      fakePypi({ requests: '2.32.3', pytest: '8.3.0' }, urls),
    );

    // Assert
    expect(model?.ecosystem).toBe('pypi');
    expect(model?.projects.map((project: PackageProject): string => project.name)).toEqual(['app']);
    expect(rows(model?.projects[0])).toEqual([
      'Requests 2.31.0 2.32.3 outdated production',
      'local null null unknown production',
      'pytest 8.3.0 8.3.0 current development',
    ]);
    // A direct reference is not looked up: the index knows nothing of it.
    expect(urls.sort()).toEqual([
      'https://pypi.org/pypi/pytest/json',
      'https://pypi.org/pypi/requests/json',
    ]);
  });

  it('load_aUvWorkspaceMember_readsTheLockAtTheWorkspaceTop', async () => {
    // Arrange
    write(path.join(root, 'pyproject.toml'), '[tool.uv.workspace]\nmembers = ["packages/*"]\n');
    write(path.join(root, 'uv.lock'), '[[package]]\nname = "rich"\nversion = "13.7.0"\n');
    write(
      path.join(root, 'packages', 'lib', 'pyproject.toml'),
      '[project]\nname = "lib"\ndependencies = ["rich"]\n',
    );

    // Act
    const projects: readonly PythonProject[] = await manager.findProjects(root);
    const model: PackageManagerModel | null = await manager.load(
      root,
      fakePypi({ rich: '13.7.0' }),
    );

    // Assert
    expect(projects.map((project: PythonProject): string | null => project.tool)).toEqual([
      'uv',
      'uv',
    ]);
    expect(rows(model?.projects[1])).toEqual(['rich 13.7.0 13.7.0 current production']);
  });

  it('load_aPoetryProject_readsPoetryLock', async () => {
    // Arrange
    write(
      path.join(root, 'pyproject.toml'),
      '[tool.poetry]\nname = "p"\n[tool.poetry.dependencies]\npython = "^3.11"\nclick = "^8"\n',
    );
    write(path.join(root, 'poetry.lock'), '[[package]]\nname = "click"\nversion = "8.1.0"\n');

    // Act
    const model: PackageManagerModel | null = await manager.load(
      root,
      fakePypi({ click: '8.1.7' }),
    );
    const project: PythonProject | null = await manager.projectAt(
      root,
      path.join(root, 'pyproject.toml'),
    );

    // Assert
    expect(rows(model?.projects[0])).toEqual(['click 8.1.0 8.1.7 outdated production']);
    expect(project?.tool).toBe('poetry');
  });

  it('load_aPipfile_readsPipfileLock', async () => {
    // Arrange
    write(path.join(root, 'Pipfile'), '[packages]\nflask = "*"\n[dev-packages]\nblack = "*"\n');
    write(
      path.join(root, 'Pipfile.lock'),
      JSON.stringify({ default: { flask: { version: '==3.0.0' } }, develop: {} }),
    );

    // Act
    const model: PackageManagerModel | null = await manager.load(
      root,
      fakePypi({ flask: '3.0.3', black: '24.1.0' }),
    );

    // Assert
    const folder: string = path.basename(root);
    expect(model?.projects[0].name).toBe(`${folder} (Pipfile)`);
    expect(rows(model?.projects[0])).toEqual([
      'flask 3.0.0 3.0.3 outdated production',
      'black null 24.1.0 unknown development',
    ]);
  });

  it('load_requirementsFilesWithNoLock_readTheVirtualEnvironment_eachFileItsOwnProject', async () => {
    // Arrange
    write(path.join(root, 'requirements.txt'), 'django>=5\n');
    write(path.join(root, 'requirements-dev.txt'), '-r requirements.txt\npytest\n');
    write(path.join(root, '.venv', 'pyvenv.cfg'), 'home = /usr/bin\n');
    mkdirSync(
      path.join(root, '.venv', 'lib', 'python3.12', 'site-packages', 'Django-5.0.1.dist-info'),
      { recursive: true },
    );

    // Act
    const model: PackageManagerModel | null = await manager.load(
      root,
      fakePypi({ django: '5.1.0', pytest: '8.3.0' }),
    );

    // Assert
    const folder: string = path.basename(root);
    expect(model?.projects.map((project: PackageProject): string => project.name)).toEqual([
      `${folder} (requirements-dev.txt)`,
      `${folder} (requirements.txt)`,
    ]);
    expect(rows(model?.projects[0])).toEqual([
      'django 5.0.1 5.1.0 outdated development',
      'pytest null 8.3.0 unknown development',
    ]);
    expect(rows(model?.projects[1])).toEqual(['django 5.0.1 5.1.0 outdated production']);
  });

  it('load_aFolderWithPyprojectAndSetupCfg_isOneProject_fromWhicheverDeclaresPackages', async () => {
    // Arrange
    write(path.join(root, 'pyproject.toml'), '[build-system]\nrequires = ["setuptools"]\n');
    write(path.join(root, 'setup.cfg'), '[options]\ninstall_requires =\n    attrs\n');
    write(path.join(root, 'setup.py'), 'from setuptools import setup\nsetup()\n');

    // Act
    const projects: readonly PythonProject[] = await manager.findProjects(root);

    // Assert
    expect(
      projects.map((project: PythonProject): string => path.basename(project.manifestPath)),
    ).toEqual(['setup.cfg']);
    expect(projects[0].tool).toBeNull();
  });

  it('findProjects_environmentsAndDependencyFolders_areNotLookedIn', async () => {
    // Arrange
    write(path.join(root, 'env', 'pyvenv.cfg'), '');
    write(path.join(root, 'env', 'lib', 'pyproject.toml'), '[project]\nname = "inside-env"\n');
    write(
      path.join(root, 'node_modules', 'x', 'pyproject.toml'),
      '[project]\nname = "inside-node-modules"\n',
    );
    write(path.join(root, '.tox', 'pyproject.toml'), '[project]\nname = "hidden"\n');
    write(path.join(root, 'svc', 'pyproject.toml'), '[project]\nname = "svc"\n');

    // Act
    const projects: readonly PythonProject[] = await manager.findProjects(root);

    // Assert
    expect(projects.map((project: PythonProject): string => project.name)).toEqual(['svc']);
  });

  it('search_anExactName_answersThatPackageFromTheNamedIndex', async () => {
    // Act
    const page: PackageSearchResult = await manager.search(
      'PyPI',
      ' Requests ',
      { skip: 0, take: 20, prerelease: false },
      fakePypi({ requests: '2.32.3' }),
    );

    // Assert
    expect(page).toEqual({
      items: [
        {
          name: 'requests',
          version: '2.32.3',
          description: 'requests summary',
          downloads: null,
          verified: false,
          sourceName: 'PyPI',
        },
      ],
      total: 1,
      hasMore: false,
    });
  });

  it.each<[string, string, string, number]>([
    ['anUnknownName', 'PyPI', 'nope', 0],
    ['aQueryThatIsNotAName', 'PyPI', 'two words', 0],
    ['anUnknownSource', 'elsewhere', 'requests', 0],
    ['aLaterPage', 'PyPI', 'requests', 20],
  ])(
    'search_%s_answersNothing',
    async (_case: string, source: string, query: string, skip: number) => {
      // Act
      const page: PackageSearchResult = await manager.search(
        source,
        query,
        { skip, take: 20, prerelease: false },
        fakePypi({ requests: '2.32.3' }),
      );

      // Assert
      expect(page.items).toEqual([]);
    },
  );

  it('load_aPrivateHttpsIndexWithNoCredential_asksStudioOnce_andNeverForPypi', async () => {
    // Arrange
    write(
      path.join(root, 'home', '.pip', 'pip.conf'),
      '[global]\nindex-url = https://pkgs.example.com/simple\nextra-index-url = https://pypi.org/simple\n',
    );
    write(path.join(root, 'requirements.txt'), 'demo\n');
    const asked: string[] = [];
    const seen: { url: string; authorization: string | undefined }[] = [];
    const asking: PypiPackageManager = new PypiPackageManager(
      (registry: string): Promise<string | null> => {
        asked.push(registry);
        return Promise.resolve('studio-token');
      },
      {},
    );
    const fetchFn: HttpFetch = (
      url: string,
      init?: { headers?: Record<string, string> },
    ): Promise<HttpResponse> => {
      seen.push({ url, authorization: init?.headers?.['Authorization'] });
      const body: unknown =
        new URL(url).hostname === 'pypi.org'
          ? { info: { name: 'demo', version: '1.0' }, releases: { '1.0': [{}] } }
          : { name: 'demo', files: [{ filename: 'demo-2.0.tar.gz' }] };
      return Promise.resolve({
        ok: true,
        status: 200,
        json: (): Promise<unknown> => Promise.resolve(body),
      });
    };

    // Act
    const model: PackageManagerModel | null = await asking.load(root, fetchFn);

    // Assert
    expect(asked).toEqual(['https://pkgs.example.com/simple/']);
    expect(model?.projects[0].packages[0].latest).toBe('2.0');
    expect(seen).toEqual([
      {
        url: 'https://pkgs.example.com/simple/demo/',
        authorization: `Basic ${Buffer.from('__token__:studio-token').toString('base64')}`,
      },
      { url: 'https://pypi.org/pypi/demo/json', authorization: undefined },
    ]);
  });
});
