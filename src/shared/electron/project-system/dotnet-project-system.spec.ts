import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ProjectEntry } from '@shared/api/project-system';
import { DebugResolveResult } from '@shared/api/debug-channels';
import { RunConfiguration } from '@shared/api/studio';
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
