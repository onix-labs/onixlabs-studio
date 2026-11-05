import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { DebugResolveResult } from '@shared/api/debug-channels';
import type { ProjectItems, ProjectModel } from '@shared/api/project-system';
import type { RunConfiguration } from '@shared/api/studio';
import { ProjectEntry } from '@shared/api/project-system';
import { DotnetProjectSystem, resolveProjectPath } from './dotnet-project-system';

describe('resolveProjectPath (#882)', () => {
  const root: string = path.resolve('/w');
  const projects: readonly ProjectEntry[] = [
    { name: 'Api', path: path.join(root, 'src', 'Api', 'Api.csproj') },
    { name: 'Api.Tests', path: path.join(root, 'tests', 'Api.Tests', 'Api.Tests.csproj') },
  ];

  it('matchesAProjectByName_asRunningItDoes', () => {
    expect(resolveProjectPath('api', root, projects)).toBe(projects[0].path);
  });

  it('matchesAProjectByTheTailOfItsPath', () => {
    expect(resolveProjectPath('Api.Tests.csproj', root, projects)).toBe(projects[1].path);
  });

  it('readsAnUnmatchedTarget_againstTheWorkspaceRoot_notTheAppsWorkingDirectory', () => {
    expect(resolveProjectPath('tools/Gen/Gen.csproj', root, projects)).toBe(
      path.join(root, 'tools', 'Gen', 'Gen.csproj'),
    );
  });

  it('keepsAnAbsoluteTargetAsItIs', () => {
    const elsewhere: string = path.resolve('/elsewhere/App.csproj');

    expect(resolveProjectPath(elsewhere, root, projects)).toBe(elsewhere);
  });
});

describe('DotnetProjectSystem.resolveDebugTarget (#882)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(realpathSync(tmpdir()), 'dotnet-debug-'));
    mkdirSync(path.join(root, 'App'));
    writeFileSync(path.join(root, 'App', 'App.csproj'), '<Project Sdk="Microsoft.NET.Sdk" />');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('refusesAProjectOutsideTheWorkspace', async () => {
    const configuration: RunConfiguration = {
      id: 'escape',
      name: 'Escape',
      providerKind: 'dotnet',
      mode: 'debug',
      target: path.resolve(root, '..', 'Other', 'Other.csproj'),
    };

    const result: DebugResolveResult = await new DotnetProjectSystem().resolveDebugTarget(
      configuration,
      root,
    );

    expect(result).toEqual({ target: null, error: 'The project is outside the workspace.' });
  });
});

describe.skipIf(process.platform === 'win32')('DotnetProjectSystem with a toolchain', () => {
  let scratch: string = '';
  let bin: string = '';
  let provider: DotnetProjectSystem;

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-dotnet-')));
    bin = path.join(scratch, 'bin');
    mkdirSync(bin);
    vi.stubEnv('DOTNET_ROOT', bin);
    vi.stubEnv('PATH', `${bin}${path.delimiter}/usr/bin${path.delimiter}/bin`);
    provider = new DotnetProjectSystem();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(scratch, { recursive: true, force: true });
  });

  /**
   * Writes files under the fixture.
   * @param files The files' contents, by relative path.
   */
  function write(files: Readonly<Record<string, string>>): void {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(scratch, name)), { recursive: true });
      writeFileSync(path.join(scratch, name), content);
    }
  }

  /**
   * Puts a fake `dotnet` in place.
   * @param body The shell script's body, given the arguments as `$@`.
   */
  function dotnet(body: string): void {
    const file: string = path.join(bin, 'dotnet');
    writeFileSync(
      file,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 10.0.100; exit 0; fi\necho "$@" >> "${file}.log"\n${body}\n`,
    );
    chmodSync(file, 0o755);
  }

  /**
   * Reads the arguments the fake `dotnet` was run with.
   * @returns Returns one line per run.
   */
  function runs(): string[] {
    const log: string = path.join(bin, 'dotnet.log');
    return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  }

  const CONFIGURATION: RunConfiguration = {
    id: 'app',
    name: 'App',
    providerKind: 'dotnet',
  } as RunConfiguration;

  describe('solutions', () => {
    it('prefersASlnxToASln', async () => {
      write({
        'App.sln': '',
        'App.slnx': '<Solution><Project Path="a/a.csproj" /></Solution>',
      });

      const model: ProjectModel | null = await provider.load(scratch);

      expect(model?.solution?.path).toBe(path.join(scratch, 'App.slnx'));
      expect(model?.capabilities.renamesSolutionFolders).toBe(true);
    });

    it('nestsSlnxProjectsInTheirFolders', async () => {
      write({
        'App.slnx':
          '<Solution><Folder Name="/src/"><Project Path="a/a.csproj" /></Folder><Folder Name="/empty/" /><Project Path="b/b.fsproj"/></Solution>',
      });

      const model: ProjectModel | null = await provider.load(scratch);

      expect(model?.projects.map((entry: { name: string }): string => entry.name)).toEqual([
        'a',
        'b',
      ]);
      expect(model?.tree[0]).toMatchObject({ type: 'folder', name: 'src' });
    });

    it('readsAClassicSln_keepingOnlyProjects', async () => {
      write({
        'App.sln': [
          'Project("{FAE04EC0}") = "app", "src\\app\\app.csproj", "{1}"',
          'EndProject',
          'Project("{2150E333}") = "items", "items", "{2}"',
          'EndProject',
        ].join('\r\n'),
      });

      const model: ProjectModel | null = await provider.load(scratch);

      expect(model?.projects).toEqual([
        { name: 'app', path: path.join(scratch, 'src', 'app', 'app.csproj') },
      ]);
      expect(model?.capabilities.renamesSolutionFolders).toBe(false);
    });

    it('anEmptyOrGarbledSolution_isASolutionOfNothing', async () => {
      write({ 'App.slnx': '<<<<' });

      expect((await provider.load(scratch))?.projects).toEqual([]);
    });

    it('findsLooseProjects_whenThereIsNoSolution', async () => {
      write({ 'a/a.csproj': '<Project/>', 'bin/b.csproj': '', 'readme.md': '' });

      const model: ProjectModel | null = await provider.load(scratch);

      expect(await provider.detect(scratch)).toBe(true);
      expect(model?.solution).toBeNull();
      expect(model?.projects.map((entry: { name: string }): string => entry.name)).toContain('a');
    });

    it('isNull_forAFolderWithNoProjects_orThatIsNotThere', async () => {
      expect(await provider.load(scratch)).toBeNull();
      expect(await provider.detect(path.join(scratch, 'gone'))).toBe(false);
    });
  });

  describe('renaming a solution folder', () => {
    it('rewritesTheSlnx', async () => {
      write({ 'App.slnx': '<Solution><Folder Name="/src/" /></Solution>' });

      expect(await provider.renameSolutionFolder(scratch, '/src/', 'code')).toEqual({
        success: true,
      });

      expect(readFileSync(path.join(scratch, 'App.slnx'), 'utf8')).toContain('/code/');
    });

    it('refusesAClassicSln', async () => {
      write({ 'App.sln': '' });

      expect((await provider.renameSolutionFolder(scratch, '/a/', 'b')).success).toBe(false);
    });

    it('refusesAFolderThatIsNotThere_leavingTheFileAlone', async () => {
      const content: string = '<Solution><Folder Name="/src/" /></Solution>';
      write({ 'App.slnx': content });

      expect((await provider.renameSolutionFolder(scratch, '/nope/', 'b')).success).toBe(false);

      expect(readFileSync(path.join(scratch, 'App.slnx'), 'utf8')).toBe(content);
    });
  });

  describe('project items', () => {
    const PROJECT: () => string = (): string => path.join(scratch, 'a', 'a.csproj');

    it('buildsTheTreeFromWhatMsbuildEvaluates', async () => {
      dotnet(
        `echo '{"Properties":{"TargetFramework":"net10.0"},"Items":{"Compile":[{"Identity":"Program.cs"},{"Identity":""}]}}'`,
      );

      const items: ProjectItems | null = await provider.loadProjectItems(PROJECT());

      expect(items?.tree.map((node: { name: string }): string => node.name)).toContain(
        'Program.cs',
      );
    });

    it('asksAgainForOneFramework_whenAProjectTargetsSeveral', async () => {
      dotnet(`case "$*" in
  *-p:TargetFramework=net8.0*) echo '{"Items":{"Compile":[{"Identity":"Pinned.cs"}]}}' ;;
  *) echo '{"Properties":{"TargetFramework":"","TargetFrameworks":"net8.0;net10.0"},"Items":{}}' ;;
esac`);

      const items: ProjectItems | null = await provider.loadProjectItems(PROJECT());

      expect(items?.tree.map((node: { name: string }): string => node.name)).toContain('Pinned.cs');
    });

    it.each<[string, string]>([
      ['aFailure', 'echo "MSB4025: not XML" >&2\nexit 1'],
      ['outputThatIsNotJson', 'echo "Welcome to .NET!"'],
    ])('isNull_for_%s', async (_name: string, body: string) => {
      dotnet(body);

      expect(await provider.loadProjectItems(PROJECT())).toBeNull();
    });

    it('isNull_whenThePinnedEvaluationFails', async () => {
      dotnet(`case "$*" in
  *-p:TargetFramework*) exit 1 ;;
  *) echo '{"Properties":{"TargetFrameworks":"net8.0"}}' ;;
esac`);

      expect(await provider.loadProjectItems(PROJECT())).toBeNull();
    });

    it('sharesOneEvaluation_betweenConcurrentCallers', async () => {
      dotnet(`echo '{"Items":{}}'`);

      await Promise.all([
        provider.loadProjectItems(PROJECT()),
        provider.loadProjectItems(PROJECT()),
      ]);

      expect(runs()).toHaveLength(1);
    });

    it('evaluatesAgainAfterAFailure', async () => {
      dotnet('exit 1');
      await provider.loadProjectItems(PROJECT());
      dotnet(`echo '{"Items":{}}'`);

      expect(await provider.loadProjectItems(PROJECT())).not.toBeNull();
    });
  });

  describe('debug targets', () => {
    it('buildsTheProject_andFindsItsOutput', async () => {
      write({ 'App.slnx': '<Solution><Project Path="app/app.csproj" /></Solution>' });
      dotnet(`case "$*" in
  *--getProperty:TargetPath*) echo "${scratch}/app/bin/app.dll" ;;
esac`);

      const result: DebugResolveResult = await provider.resolveDebugTarget(
        { ...CONFIGURATION, target: path.join(scratch, 'app', 'app.csproj') },
        scratch,
      );

      expect(result).toEqual({
        target: { program: `${scratch}/app/bin/app.dll`, cwd: path.join(scratch, 'app') },
        error: null,
      });
      expect(runs()[0]).toContain('-c Debug');
    });

    it('refusesAProjectOutsideTheWorkspace_beforeBuildingAnything', async () => {
      write({ 'App.slnx': '<Solution />' });
      dotnet('exit 0');

      const result: DebugResolveResult = await provider.resolveDebugTarget(
        { ...CONFIGURATION, target: '/elsewhere/evil.csproj' },
        scratch,
      );

      expect(result).toEqual({ target: null, error: 'The project is outside the workspace.' });
      expect(runs()).toEqual([]);
    });

    it('reportsWhatTheBuildSaid_whenItFails', async () => {
      write({ 'App.slnx': '<Solution><Project Path="app/app.csproj" /></Solution>' });
      dotnet('echo "error CS1002: ; expected"\nexit 1');

      const result: DebugResolveResult = await provider.resolveDebugTarget(
        { ...CONFIGURATION, target: path.join(scratch, 'app', 'app.csproj') },
        scratch,
      );

      expect(result.target).toBeNull();
      expect(result.error).toContain('CS1002');
    });

    it('saysSo_whenTheBuildLeavesNoOutputPath', async () => {
      write({ 'App.slnx': '<Solution><Project Path="app/app.csproj" /></Solution>' });
      dotnet('exit 0');

      const result: DebugResolveResult = await provider.resolveDebugTarget(
        { ...CONFIGURATION, target: path.join(scratch, 'app', 'app.csproj') },
        scratch,
      );

      expect(result.error).toMatch(/output assembly/);
    });
  });

  describe('compiled artifacts', () => {
    it('isNull_forASourceWithNoProject', async () => {
      write({ 'loose.cs': '' });

      expect(await provider.resolveArtifact(path.join(scratch, 'loose.cs'))).toBeNull();
    });

    it('isNull_whenNotBuiltYet', async () => {
      write({ 'app/app.csproj': '', 'app/a.cs': '' });
      dotnet(`echo "${scratch}/app/bin/app.dll"`);

      expect(await provider.resolveArtifact(path.join(scratch, 'app', 'a.cs'))).toBeNull();
    });

    it('findsTheOutputAndItsSymbols_andSaysWhenTheSourceIsNewer', async () => {
      write({ 'app/app.csproj': '', 'app/a.cs': '', 'app/bin/app.dll': '', 'app/bin/app.pdb': '' });
      utimesSync(path.join(scratch, 'app/bin/app.dll'), 1_000, 1_000);
      dotnet(`echo "${scratch}/app/bin/app.dll"`);

      expect(await provider.resolveArtifact(path.join(scratch, 'app', 'a.cs'))).toEqual({
        artifactPath: `${scratch}/app/bin/app.dll`,
        symbolsPath: `${scratch}/app/bin/app.pdb`,
        stale: true,
      });
    });
  });
});
