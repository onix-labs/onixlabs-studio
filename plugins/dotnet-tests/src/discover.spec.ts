import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestNode } from '../../protocol/testing/protocol';
import {
  applicableTo,
  discoverTests,
  projectId,
  projectNameCondition,
  readTestProject,
} from './discover';

/**
 * Writes files into a folder.
 * @param root The folder.
 * @param files The files, by relative path.
 */
function write(root: string, files: Readonly<Record<string, string>>): void {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
}

describe('.NET test discovery (#1353)', () => {
  it.each<[string, string, readonly string[] | null]>([
    ['xUnit', '<PackageReference Include="xunit" Version="2.9.3" />', ['xUnit']],
    ['xUnit v3', '<PackageReference Include="xunit.v3" Version="1.0.0" />', ['xUnit']],
    ['NUnit', '<PackageReference Include="NUnit" Version="4.3.2" />', ['NUnit']],
    ['MSTest', '<PackageReference Include="MSTest" Version="4.0.2" />', ['MSTest']],
    ['MSTest.TestFramework', '<PackageReference Include="MSTest.TestFramework" />', ['MSTest']],
    ['the test SDK alone', '<PackageReference Include="Microsoft.NET.Test.Sdk" />', []],
    ['IsTestProject', '<IsTestProject>true</IsTestProject>', []],
    ['a library', '<PackageReference Include="Newtonsoft.Json" />', null],
    ['the analyzers only', '<PackageReference Include="NUnit.Analyzers" />', null],
  ])(
    'readTestProject reads %s',
    (_name: string, body: string, expected: readonly string[] | null) => {
      expect(
        readTestProject(
          `<Project Sdk="Microsoft.NET.Sdk"><ItemGroup>${body}</ItemGroup></Project>`,
        ),
      ).toEqual(expected);
    },
  );

  it('readTestProject_readsTheMSTestSdk', () => {
    expect(readTestProject('<Project Sdk="MSTest.Sdk/3.6.0"></Project>')).toEqual(['MSTest']);
  });

  describe('discoverTests', () => {
    let root: string = '';

    beforeAll(() => {
      root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dotnet-discover-')));
      write(root, {
        'Shop.sln': '',
        'src/Shop/Shop.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>',
        'src/Shop/Cart.cs':
          'namespace Shop; public class Cart { [Fact] public void NotATest() { } }',
        'tests/Shop.XunitTests/Shop.XunitTests.csproj':
          '<Project><ItemGroup><PackageReference Include="xunit" /></ItemGroup></Project>',
        'tests/Shop.XunitTests/CartTests.cs':
          'namespace Shop.XunitTests;\npublic class CartTests\n{\n    [Fact]\n    public void Adds() { }\n}\n',
        'tests/Shop.XunitTests/bin/Debug/Generated.cs':
          'namespace X; public class G { [Fact] public void Built() { } }',
        'tests/Shop.NUnitTests/Shop.NUnitTests.csproj':
          '<Project><ItemGroup><PackageReference Include="NUnit" /></ItemGroup></Project>',
        'tests/Shop.NUnitTests/CartTests.cs':
          'namespace Shop.NUnitTests\n{\n    public class CartTests\n    {\n        [Theory]\n        public void Holds() { }\n        [Fact]\n        public void XunitsAttributeMeansNothingHere() { }\n    }\n}\n',
        'tests/Shop.MSTests/Shop.MSTests.csproj':
          '<Project><ItemGroup><PackageReference Include="MSTest" /></ItemGroup></Project>',
        'tests/Shop.MSTests/CartTests.cs':
          'namespace Shop.MSTests;\n[TestClass]\npublic class CartTests\n{\n    [TestMethod]\n    public void Totals() { }\n    [TestMethod]\n    public void Totals(int overload) { }\n}\n',
      });
    });

    afterAll(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('buildsProjectClassAndTestNodes_forEveryTestProject_andNothingElse', async () => {
      const tree: readonly TestNode[] = await discoverTests(root);
      const ms: string = path.join(root, 'tests', 'Shop.MSTests', 'Shop.MSTests.csproj');

      expect(tree.map((node: TestNode): string => node.label)).toEqual([
        'Shop.MSTests',
        'Shop.NUnitTests',
        'Shop.XunitTests',
      ]);
      expect(tree[0]).toEqual({
        id: projectId(ms),
        label: 'Shop.MSTests',
        kind: 'project',
        framework: 'MSTest',
        location: { file: ms, line: 1 },
        children: [
          {
            id: 'Shop.MSTests.CartTests',
            label: 'Shop.MSTests.CartTests',
            kind: 'suite',
            location: { file: path.join(root, 'tests', 'Shop.MSTests', 'CartTests.cs'), line: 3 },
            children: [
              {
                id: 'Shop.MSTests.CartTests.Totals',
                label: 'Totals',
                kind: 'test',
                location: {
                  file: path.join(root, 'tests', 'Shop.MSTests', 'CartTests.cs'),
                  line: 6,
                },
              },
            ],
          },
        ],
      });
      // NUnit's Theory is a test there; xUnit's Fact is not.
      expect(tree[1].children?.[0].children?.map((test: TestNode): string => test.id)).toEqual([
        'Shop.NUnitTests.CartTests.Holds',
      ]);
      // bin/ is skipped: what a build wrote is not the user's source.
      expect(tree[2].children?.map((suite: TestNode): string => suite.id)).toEqual([
        'Shop.XunitTests.CartTests',
      ]);
    });
  });

  it('readTestProject_aLaterIsTestProjectFalse_turnsOffAnEarlierTrue', () => {
    expect(
      readTestProject(
        '<IsTestProject>true</IsTestProject><PackageReference Include="xunit" /><IsTestProject>false</IsTestProject>',
      ),
    ).toBeNull();
  });

  it.each<[string, string, boolean | undefined]>([
    [
      "$([System.String]::Copy('$(MSBuildProjectName)').EndsWith('.UnitTests'))",
      'A.UnitTests',
      true,
    ],
    [
      "$([System.String]::Copy('$(MSBuildProjectName)').EndsWith('.UnitTests'))",
      'A.UnitTests.Data',
      false,
    ],
    ["$(MSBuildProjectName.EndsWith('Tests'))", 'A.Tests', true],
    ["!$(MSBuildProjectName.StartsWith('Shop'))", 'Shop.Tests', false],
    ["'$(MSBuildProjectName.Contains('Test'))' == 'true'", 'A.Tests', true],
    ["'$(MSBuildProjectName.Contains('Test'))' == 'false'", 'A.Tests', false],
    ["'$(MSBuildProjectName)' == 'shop.tests'", 'Shop.Tests', true],
    ["'$(MSBuildProjectName)' != 'Shop.Tests'", 'Shop.Tests', false],
    [
      "$(MSBuildProjectName.EndsWith('Tests')) and '$(MSBuildProjectName)' != 'Shop.Tests'",
      'Shop.Tests',
      false,
    ],
    ["'$(Configuration)' == 'Debug'", 'A.Tests', undefined],
    ["$(MSBuildProjectName.EndsWith('Tests')) and '$(CI)' == 'true'", 'A.Tests', undefined],
  ])('projectNameCondition decides %s for %s', (condition, name, expected) => {
    expect(projectNameCondition(condition, name)).toBe(expected);
  });

  it('applicableTo_dropsGroupsAndReferencesTheNameRulesOut_andKeepsWhatItCannotTell', () => {
    const xml: string = [
      '<ItemGroup Condition="$(MSBuildProjectName.EndsWith(\'.Benchmarks\'))"><PackageReference Include="BenchmarkDotNet" /></ItemGroup>',
      '<ItemGroup Condition="\'$(CI)\' == \'true\'"><PackageReference Include="Kept" /></ItemGroup>',
      '<PackageReference Include="xunit" Condition="$(MSBuildProjectName.EndsWith(\'.Tests\'))" />',
    ].join('');
    const kept: string = applicableTo(xml, 'Shop.Tests');
    expect(kept).not.toContain('BenchmarkDotNet');
    expect(kept).toContain('Kept');
    expect(kept).toContain('xunit');
    expect(applicableTo(xml, 'Shop.Benchmarks')).not.toContain('xunit');
  });

  describe('discoverTests with a shared Directory.Build.props', () => {
    let root: string = '';

    beforeAll(() => {
      root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dotnet-discover-props-')));
      const when: (suffix: string) => string = (suffix: string): string =>
        `Condition="$([System.String]::Copy('$(MSBuildProjectName)').EndsWith('${suffix}'))"`;
      write(root, {
        'Shop.slnx': '',
        // As a repository that gives every *.UnitTests project its framework from one file does.
        'Directory.Build.props': [
          '<Project>',
          `<PropertyGroup ${when('.UnitTests')}><IsTestProject>true</IsTestProject></PropertyGroup>`,
          `<ItemGroup ${when('.UnitTests')}><PackageReference Include="xunit.v3" /></ItemGroup>`,
          `<ItemGroup ${when('.Benchmarks')}><PackageReference Include="BenchmarkDotNet" /></ItemGroup>`,
          `<PropertyGroup ${when('.UnitTests.Data')}><IsTestProject>false</IsTestProject></PropertyGroup>`,
          `<ItemGroup ${when('.UnitTests.Data')}><PackageReference Include="xunit.v3.extensibility.core" /></ItemGroup>`,
          '</Project>',
        ].join('\n'),
        'Shop.UnitTests/Shop.UnitTests.csproj':
          '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Microsoft.Testing.Extensions.CodeCoverage" /></ItemGroup></Project>',
        'Shop.UnitTests/CartTests.cs':
          'namespace Shop.UnitTests;\npublic sealed class CartTests\n{\n    [Fact(DisplayName = "Adds")]\n    public void Adds() { }\n}\n',
        'Shop.UnitTests.Data/Shop.UnitTests.Data.csproj':
          '<Project Sdk="Microsoft.NET.Sdk"></Project>',
        'Shop.UnitTests.Data/Fixture.cs':
          'namespace Shop.UnitTests.Data;\npublic class Fixture { [Fact] public void NotATest() { } }\n',
        'Shop.Benchmarks/Shop.Benchmarks.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>',
      });
    });

    afterAll(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('findsTheProjectsThePropsMakeTestProjects_andLeavesTheRestOut', async () => {
      const tree: readonly TestNode[] = await discoverTests(root);
      expect(tree.map((project: TestNode): string => project.label)).toEqual(['Shop.UnitTests']);
      expect(tree[0].framework).toBe('xUnit');
      expect(tree[0].children?.[0].children?.map((test: TestNode): string => test.id)).toEqual([
        'Shop.UnitTests.CartTests.Adds',
      ]);
    });
  });
});
