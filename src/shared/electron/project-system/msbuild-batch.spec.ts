import * as path from 'node:path';
import { EvaluatedItem } from './item-tree';
import {
  batchArguments,
  batchCollectProject,
  batchItemsTargets,
  parseBatchOutput,
  projectKey,
  splitIntoBatches,
} from './msbuild-batch';

/**
 * The item types every case reads, in the order they are shown.
 */
const TYPES: readonly string[] = ['Compile', 'None'];

/**
 * A project every case answers for.
 */
const PROJECT: string = path.resolve('/w/A/A.csproj');

/**
 * Wraps items as the batch prints them.
 * @param items The items the wrapper target returned.
 * @returns Returns the batch's JSON.
 */
function output(items: readonly (object | null)[]): string {
  return JSON.stringify({ TargetResults: { StudioCollect: { Items: items } } });
}

describe('msbuild-batch (#1600)', () => {
  describe('splitIntoBatches', () => {
    it.each<[number, number, readonly number[]]>([
      [1, 4, [1]],
      [4, 4, [4]],
      [5, 4, [3, 2]],
      [16, 4, [4, 4, 4, 4]],
      [42, 4, [11, 11, 11, 9]],
    ])(
      'splits_%i_projectsInto_atMost_%i',
      (count: number, most: number, sizes: readonly number[]) => {
        const projects: string[] = Array.from(
          { length: count },
          (_: unknown, i: number): string => `p${i}`,
        );

        const batches: readonly (readonly string[])[] = splitIntoBatches(projects, most);

        expect(batches.map((batch: readonly string[]): number => batch.length)).toEqual(sizes);
        expect(batches.flat()).toEqual(projects);
      },
    );

    it('isEmpty_forNoProjects', () => {
      expect(splitIntoBatches([], 4)).toEqual([]);
    });
  });

  describe('parseBatchOutput', () => {
    it('groupsItemsByProject_inTheOrderTheTypesAreShown', () => {
      const parsed: ReadonlyMap<string, readonly EvaluatedItem[]> | null = parseBatchOutput(
        output([
          { Identity: PROJECT, Kind: 'StudioProject', Project: PROJECT },
          { Identity: 'readme.md', Kind: 'None', Project: PROJECT },
          { Identity: 'Program.cs', Kind: 'Compile', Project: PROJECT, Link: 'Linked/Program.cs' },
          { Identity: 'skipped.res', Kind: 'EmbeddedResource', Project: PROJECT },
        ]),
        TYPES,
        'linux',
      );

      expect(parsed?.get(PROJECT)).toEqual([
        { identity: 'Program.cs', link: 'Linked/Program.cs' },
        { identity: 'readme.md', link: '' },
      ]);
    });

    it('keepsAProjectWithNoFiles_butNotOneThatFailed', () => {
      // A failed project returns nothing at all, so its marker tells the two apart.
      const parsed: ReadonlyMap<string, readonly EvaluatedItem[]> | null = parseBatchOutput(
        output([{ Identity: PROJECT, Kind: 'StudioProject', Project: PROJECT }]),
        TYPES,
        'linux',
      );

      expect(parsed?.get(PROJECT)).toEqual([]);
      expect(parsed?.has(path.resolve('/w/B/B.csproj'))).toBe(false);
    });

    it('matchesAProjectWhateverItsCase_whereTheFileSystemIgnoresCase', () => {
      const parsed: ReadonlyMap<string, readonly EvaluatedItem[]> | null = parseBatchOutput(
        output([{ Identity: 'x', Kind: 'StudioProject', Project: PROJECT.toUpperCase() }]),
        TYPES,
        'darwin',
      );

      expect(parsed?.has(projectKey(PROJECT, 'darwin'))).toBe(true);
    });

    it.each<[string, string]>([
      ['notJson', 'Welcome to .NET!'],
      ['noTargetResult', '{"Items":{}}'],
      ['null', 'null'],
    ])('isNull_for_%s', (_name: string, text: string) => {
      expect(parseBatchOutput(text, TYPES, 'linux')).toBeNull();
    });

    it('skipsEntriesItCannotRead', () => {
      const parsed: ReadonlyMap<string, readonly EvaluatedItem[]> | null = parseBatchOutput(
        output([
          null,
          { Identity: 'a.cs', Kind: 'Compile' },
          { Identity: '', Kind: 'Compile', Project: PROJECT },
          { Identity: PROJECT, Kind: 'StudioProject', Project: PROJECT },
        ]),
        TYPES,
        'linux',
      );

      expect([...(parsed?.entries() ?? [])]).toEqual([[PROJECT, []]]);
    });
  });

  describe('the MSBuild files', () => {
    it('returnEachTypesItemsWithTheirLink_andAMarker', () => {
      const targets: string = batchItemsTargets(TYPES);

      expect(targets).toContain('Include="@(Compile)" KeepMetadata="Link" Kind="Compile"');
      expect(targets).toContain('Kind="StudioProject"');
    });

    it('carryOnPastAProjectThatFails_andImportTheTargetsIntoEach', () => {
      const collect: string = batchCollectProject('/tmp/s/studio-items.targets');

      expect(collect).toContain('ContinueOnError="true"');
      expect(collect).toContain('CustomAfterMicrosoftCommonTargets=/tmp/s/studio-items.targets');
      expect(collect).toContain('CustomAfterMicrosoftCommonCrossTargetingTargets=');
    });

    it('runOnOneNode_andPrintTheResult', () => {
      expect(batchArguments('/c.proj', '/l.txt')).toEqual([
        'msbuild',
        '/c.proj',
        '-nologo',
        '-t:StudioCollect',
        '-p:StudioProjectList=/l.txt',
        '-getTargetResult:StudioCollect',
        '-m:1',
      ]);
    });
  });
});
