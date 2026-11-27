import * as path from 'node:path';
import { EvaluatedItem } from './item-tree';

/**
 * Names the target the batch runs on its wrapper project, and the item each project's target returns.
 */
export const BATCH_TARGET: string = 'StudioCollect';

/**
 * Names the property carrying the file that lists the projects to evaluate, one per line.
 */
export const BATCH_PROJECT_LIST_PROPERTY: string = 'StudioProjectList';

/**
 * Marks the item each evaluated project returns for itself, so a project with no files at all is
 * told apart from one that failed: a failed project returns nothing, not even this.
 */
const PROJECT_MARKER: string = 'StudioProject';

/**
 * Gets the targets file imported into every project the batch evaluates, through
 * `CustomAfterMicrosoftCommonTargets` (and its cross-targeting twin, for a multi-targeted project's
 * outer build). Its target returns the project's file items, as `--getItem` would list them: the
 * identity as the project wrote it, with its `Link`. A multi-targeted project answers for its first
 * framework, as the one-project evaluation does, by calling itself with that framework set.
 * @param itemTypes The item types to return, in the order they are shown.
 * @returns Returns the targets file's text.
 */
export function batchItemsTargets(itemTypes: readonly string[]): string {
  const items: string = itemTypes
    .map(
      (type: string): string =>
        `      <_StudioItem Include="@(${type})" KeepMetadata="Link" Kind="${type}" Project="$(MSBuildProjectFullPath)" />`,
    )
    .join('\n');
  return `<Project>
  <!-- Written by ONIXLabs Studio to list a solution's files in one MSBuild run. -->
  <Target Name="StudioItems" Returns="@(_StudioItem)">
    <PropertyGroup Condition="'$(TargetFramework)' == '' and '$(TargetFrameworks)' != ''">
      <_StudioFirstFramework>$([System.String]::Copy('$(TargetFrameworks)').Split(';')[0].Trim())</_StudioFirstFramework>
    </PropertyGroup>
    <MSBuild Condition="'$(_StudioFirstFramework)' != ''" Projects="$(MSBuildProjectFullPath)" Targets="StudioItems" Properties="TargetFramework=$(_StudioFirstFramework)">
      <Output TaskParameter="TargetOutputs" ItemName="_StudioItem" />
    </MSBuild>
    <ItemGroup Condition="'$(_StudioFirstFramework)' == ''">
      <_StudioItem Include="$(MSBuildProjectFullPath)" Kind="${PROJECT_MARKER}" Project="$(MSBuildProjectFullPath)" />
${items}
    </ItemGroup>
  </Target>
</Project>
`;
}

/**
 * Gets the wrapper project the batch runs: it reads the list of projects and calls the items target
 * on each. A project that fails to evaluate does not fail the rest (`ContinueOnError`); it is simply
 * missing from the answer, and is evaluated on its own instead.
 * @param targetsPath The absolute path of the items targets file.
 * @returns Returns the wrapper project's text.
 */
export function batchCollectProject(targetsPath: string): string {
  return `<Project>
  <!-- Written by ONIXLabs Studio to list a solution's files in one MSBuild run. -->
  <Target Name="${BATCH_TARGET}" Returns="@(_StudioAll)">
    <ReadLinesFromFile File="$(${BATCH_PROJECT_LIST_PROPERTY})">
      <Output TaskParameter="Lines" ItemName="_StudioProject" />
    </ReadLinesFromFile>
    <MSBuild Projects="@(_StudioProject)" Targets="StudioItems" ContinueOnError="true"
             Properties="CustomAfterMicrosoftCommonTargets=${targetsPath};CustomAfterMicrosoftCommonCrossTargetingTargets=${targetsPath}">
      <Output TaskParameter="TargetOutputs" ItemName="_StudioAll" />
    </MSBuild>
  </Target>
</Project>
`;
}

/**
 * Gets the arguments that run the batch over one list of projects, printing the wrapper target's
 * result as JSON. One node (`-m:1`): parallelism comes from running a few batches side by side, which
 * needs no MSBuild worker nodes left behind.
 * @param collectPath The absolute path of the wrapper project.
 * @param listPath The absolute path of the file listing the projects.
 * @returns Returns the arguments.
 */
export function batchArguments(collectPath: string, listPath: string): readonly string[] {
  return [
    'msbuild',
    collectPath,
    '-nologo',
    `-t:${BATCH_TARGET}`,
    `-p:${BATCH_PROJECT_LIST_PROPERTY}=${listPath}`,
    `-getTargetResult:${BATCH_TARGET}`,
    '-m:1',
  ];
}

/**
 * Splits projects into the few batches run side by side: at most `batches`, and none smaller than
 * needed to make a batch worth a process of its own.
 * @param projects The project paths.
 * @param batches The most batches to run at once.
 * @returns Returns the batches, in the projects' order.
 */
export function splitIntoBatches(
  projects: readonly string[],
  batches: number,
): readonly (readonly string[])[] {
  const count: number = Math.max(1, Math.min(batches, Math.ceil(projects.length / 4)));
  const size: number = Math.ceil(projects.length / count);
  const result: string[][] = [];
  for (let start: number = 0; start < projects.length; start += size) {
    result.push(projects.slice(start, start + size));
  }
  return result;
}

/**
 * Gets the key a project is matched by: its resolved path, and on a case-insensitive file system its
 * case too, as MSBuild may spell it differently from the solution.
 * @param projectPath The project path.
 * @param platform The platform, for case sensitivity.
 * @returns Returns the key.
 */
export function projectKey(projectPath: string, platform: NodeJS.Platform): string {
  const resolved: string = path.resolve(projectPath);
  return platform === 'win32' || platform === 'darwin' ? resolved.toLowerCase() : resolved;
}

/**
 * Reads the batch's answer: each project's file items, by project key. A project that failed to
 * evaluate is absent, not empty — its marker item is missing — so it can be evaluated on its own.
 * @param output The JSON MSBuild printed.
 * @param itemTypes The item types to keep, in the order they are shown.
 * @param platform The platform, for matching project paths.
 * @returns Returns the items by project key, or null when the output cannot be read.
 */
export function parseBatchOutput(
  output: string,
  itemTypes: readonly string[],
  platform: NodeJS.Platform,
): ReadonlyMap<string, readonly EvaluatedItem[]> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }
  const items: unknown = (parsed as { TargetResults?: Record<string, { Items?: unknown }> } | null)
    ?.TargetResults?.[BATCH_TARGET]?.Items;
  if (!Array.isArray(items)) {
    return null;
  }
  const byKind: Map<string, Map<string, EvaluatedItem[]>> = new Map<
    string,
    Map<string, EvaluatedItem[]>
  >();
  for (const entry of items as readonly unknown[]) {
    const item: { Identity?: unknown; Kind?: unknown; Link?: unknown; Project?: unknown } =
      entry ?? {};
    if (typeof item.Project !== 'string' || typeof item.Kind !== 'string') {
      continue;
    }
    const key: string = projectKey(item.Project, platform);
    let kinds: Map<string, EvaluatedItem[]> | undefined = byKind.get(key);
    if (kinds === undefined) {
      kinds = new Map<string, EvaluatedItem[]>();
      byKind.set(key, kinds);
    }
    if (item.Kind === PROJECT_MARKER) {
      continue;
    }
    if (typeof item.Identity !== 'string' || item.Identity.length === 0) {
      continue;
    }
    const list: EvaluatedItem[] = kinds.get(item.Kind) ?? [];
    list.push({ identity: item.Identity, link: typeof item.Link === 'string' ? item.Link : '' });
    kinds.set(item.Kind, list);
  }
  const result: Map<string, readonly EvaluatedItem[]> = new Map<string, readonly EvaluatedItem[]>();
  for (const [key, kinds] of byKind) {
    result.set(
      key,
      itemTypes.flatMap((type: string): readonly EvaluatedItem[] => kinds.get(type) ?? []),
    );
  }
  return result;
}
