// Finds a folder's .NET tests by reading its project files and C# sources (#1353). ⛔ Nothing is built,
// restored or run: which projects are test projects is read from their XML, and which methods are tests
// from their attributes.
import * as path from 'node:path';
import type { TestNode } from '../../protocol/testing/protocol';
import { readSource, walkFiles } from '../../protocol/testing/source';
import { scanCSharp, ScannedTest } from './csharp-scan';

/**
 * Names a test framework the adapter knows.
 */
export type DotnetFramework = 'xUnit' | 'NUnit' | 'MSTest';

/**
 * The attributes that make a method a test, per framework. `Theory` is xUnit's and NUnit's both, so a
 * project's references decide which it means.
 */
export const TEST_ATTRIBUTES: Readonly<Record<DotnetFramework, readonly string[]>> = {
  xUnit: ['Fact', 'Theory', 'SkippableFact', 'SkippableTheory'],
  NUnit: ['Test', 'TestCase', 'TestCaseSource', 'Theory'],
  MSTest: ['TestMethod', 'DataTestMethod'],
};

/**
 * The package references that say which framework a project uses.
 */
const FRAMEWORK_PACKAGES: readonly (readonly [RegExp, DotnetFramework])[] = [
  [/^xunit(\.v3)?(\.core)?$/i, 'xUnit'],
  [/^nunit$/i, 'NUnit'],
  [/^mstest(\.testframework)?$/i, 'MSTest'],
];

/**
 * The project-file names the adapter reads.
 */
const PROJECT_FILE: RegExp = /\.(cs|fs)proj$/i;

/**
 * Describes a test project found in a folder.
 */
export interface TestProject {
  /**
   * Gets the absolute path of the project file.
   */
  readonly file: string;

  /**
   * Gets the project's name, its file name without the extension.
   */
  readonly name: string;

  /**
   * Gets the frameworks it references, in the order they were found.
   */
  readonly frameworks: readonly DotnetFramework[];
}

/**
 * Reads which test frameworks a project file references, and whether it is a test project at all.
 * @param xml The project file's text.
 * @returns Returns the frameworks, or null when it is not a test project.
 */
export function readTestProject(xml: string): readonly DotnetFramework[] | null {
  const frameworks: DotnetFramework[] = [];
  const add: (framework: DotnetFramework) => void = (framework: DotnetFramework): void => {
    if (!frameworks.includes(framework)) {
      frameworks.push(framework);
    }
  };
  const references: RegExp = /<PackageReference\s+[^>]*Include\s*=\s*"([^"]+)"/gi;
  let match: RegExpExecArray | null = references.exec(xml);
  let testSdk: boolean = false;
  while (match !== null) {
    const name: string = match[1].trim();
    for (const [pattern, framework] of FRAMEWORK_PACKAGES) {
      if (pattern.test(name)) {
        add(framework);
      }
    }
    testSdk ||= /^Microsoft\.NET\.Test\.Sdk$/i.test(name);
    match = references.exec(xml);
  }
  if (/<Project\s+[^>]*Sdk\s*=\s*"MSTest\.Sdk/i.test(xml)) {
    add('MSTest');
  }
  // The last IsTestProject wins, as MSBuild reads a property: a project can turn off what a shared
  // Directory.Build.props turned on.
  const flags: readonly RegExpMatchArray[] = [
    ...xml.matchAll(/<IsTestProject>\s*(true|false)\s*<\/IsTestProject>/gi),
  ];
  const flag: string | undefined = flags[flags.length - 1]?.[1].toLowerCase();
  if (flag === 'false') {
    return null;
  }
  return frameworks.length > 0 || testSdk || flag === 'true' ? frameworks : null;
}

/**
 * The files MSBuild imports around every project: the nearest of each, searching up from the project.
 */
const DIRECTORY_BUILD_FILES: readonly string[] = [
  'Directory.Build.props',
  'Directory.Build.targets',
];

/**
 * The name tests a condition makes, as shared props files commonly write them: a string function on
 * the project's name, `$(MSBuildProjectName.EndsWith('X'))` or
 * `$([System.String]::Copy('$(MSBuildProjectName)').EndsWith('X'))`, optionally `!`-negated or quoted and
 * compared with `'true'`.
 */
const NAME_CALL: RegExp =
  /^(!)?\s*('?)\$\((?:MSBuildProjectName|\[System\.String\]::Copy\(\s*'\$\(MSBuildProjectName\)'\s*\))\.(EndsWith|StartsWith|Contains)\(\s*'([^']*)'\s*\)\)\2(?:\s*(==|!=)\s*'(true|false)')?$/i;

/**
 * The name comparison a condition makes: `'$(MSBuildProjectName)' == 'X'`.
 */
const NAME_COMPARE: RegExp = /^'\$\(MSBuildProjectName\)'\s*(==|!=)\s*'([^']*)'$/i;

/**
 * Decides one term of a condition that tests the project's name.
 * @param term The term.
 * @param projectName The project's name.
 * @returns Returns whether it holds, or undefined when it is not a name test.
 */
function nameTerm(term: string, projectName: string): boolean | undefined {
  const called: RegExpExecArray | null = NAME_CALL.exec(term);
  if (called !== null) {
    const [, not, , method, text, operator, expected] = called;
    const lower: string = method.toLowerCase();
    let value: boolean =
      lower === 'endswith'
        ? projectName.endsWith(text)
        : lower === 'startswith'
          ? projectName.startsWith(text)
          : projectName.includes(text);
    if (operator !== undefined && (operator === '==') !== (expected.toLowerCase() === 'true')) {
      value = !value;
    }
    return not === undefined ? value : !value;
  }
  const compared: RegExpExecArray | null = NAME_COMPARE.exec(term);
  if (compared !== null) {
    // MSBuild compares strings without regard to case.
    const equal: boolean = projectName.toLowerCase() === compared[2].toLowerCase();
    return compared[1] === '==' ? equal : !equal;
  }
  return undefined;
}

/**
 * Decides a condition that tests only the project's name, its terms all joined by `and` or all by `or`.
 * @param condition The condition's text.
 * @param projectName The project's name.
 * @returns Returns whether it holds, or undefined when it tests anything else.
 */
export function projectNameCondition(condition: string, projectName: string): boolean | undefined {
  const parts: readonly string[] = condition.trim().split(/\s+(and|or)\s+/i);
  const joiners: ReadonlySet<string> = new Set<string>(
    parts
      .filter((_part: string, index: number): boolean => index % 2 === 1)
      .map((part) => part.toLowerCase()),
  );
  if (joiners.size > 1) {
    return undefined;
  }
  const values: (boolean | undefined)[] = parts
    .filter((_part: string, index: number): boolean => index % 2 === 0)
    .map((term: string): boolean | undefined => nameTerm(term.trim(), projectName));
  if (values.includes(undefined)) {
    return undefined;
  }
  return joiners.has('or') ? values.includes(true) : !values.includes(false);
}

/**
 * Drops the property and item groups, and package references, whose condition rules out a project by
 * its name. A condition that cannot be told is kept, so a test project is never lost to one.
 * @param xml A props or project file's text.
 * @param projectName The project's name.
 * @returns Returns the text with only what applies to the project.
 */
export function applicableTo(xml: string, projectName: string): string {
  const excluded: (attributes: string) => boolean = (attributes: string): boolean => {
    const condition: RegExpExecArray | null = /\bCondition\s*=\s*"([^"]*)"/i.exec(attributes);
    return (
      condition !== null && projectNameCondition(decodeXml(condition[1]), projectName) === false
    );
  };
  return xml
    .replace(
      /<(PropertyGroup|ItemGroup)\b([^>]*)>[\s\S]*?<\/\1>/gi,
      (group: string, _tag: string, attributes: string): string =>
        excluded(attributes) ? '' : group,
    )
    .replace(
      /<PackageReference\b([^>]*?)(?:\/>|>[\s\S]*?<\/PackageReference>)/gi,
      (reference: string, attributes: string): string => (excluded(attributes) ? '' : reference),
    );
}

/**
 * Decodes the entities a condition attribute uses for its quotes and operators.
 * @param text The attribute's text.
 * @returns Returns the decoded text.
 */
function decodeXml(text: string): string {
  return text
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Finds the nearest of a file named so, from a folder up to the walk's root.
 * @param directory The folder to start in.
 * @param root The folder the search stops at.
 * @param name The file's name.
 * @returns Returns its text, or null when there is none.
 */
async function nearest(directory: string, root: string, name: string): Promise<string | null> {
  let current: string = directory;
  for (;;) {
    const text: string | null = await readSource(path.join(current, name));
    if (text !== null) {
      return text;
    }
    const parent: string = path.dirname(current);
    if (current === root || parent === current || path.relative(root, parent).startsWith('..')) {
      return null;
    }
    current = parent;
  }
}

/**
 * Reads a project as MSBuild sees it for deciding whether it holds tests: the nearest
 * Directory.Build.props, the project file, then the nearest Directory.Build.targets, each cut to what
 * applies to the project's name.
 * @param file The project file's absolute path.
 * @param root The folder discovery started in.
 * @returns Returns the combined text, or null when the project file cannot be read.
 */
async function readProject(file: string, root: string): Promise<string | null> {
  const xml: string | null = await readSource(file);
  if (xml === null) {
    return null;
  }
  const name: string = path.basename(file).replace(PROJECT_FILE, '');
  const directory: string = path.dirname(file);
  const [props, targets] = await Promise.all(
    DIRECTORY_BUILD_FILES.map((shared: string) => nearest(directory, root, shared)),
  );
  return [props, xml, targets]
    .filter((text: string | null): text is string => text !== null)
    .map((text: string): string => applicableTo(text, name))
    .join('\n');
}

/**
 * Finds the test projects in a folder.
 * @param root The absolute folder.
 * @returns Returns the projects, by path.
 */
export async function findTestProjects(root: string): Promise<readonly TestProject[]> {
  const files: readonly string[] = await walkFiles(root, {
    accept: (name: string): boolean => PROJECT_FILE.test(name),
  });
  const projects: TestProject[] = [];
  for (const file of files) {
    const xml: string | null = await readProject(file, root);
    const frameworks: readonly DotnetFramework[] | null =
      xml === null ? null : readTestProject(xml);
    if (frameworks !== null) {
      projects.push({ file, name: path.basename(file).replace(PROJECT_FILE, ''), frameworks });
    }
  }
  return projects;
}

/**
 * Builds the identifier of a project's node.
 * @param file The project file's absolute path.
 * @returns Returns the identifier.
 */
export function projectId(file: string): string {
  return `project:${file}`;
}

/**
 * Finds the tests a project's sources declare.
 * @param project The project.
 * @returns Returns each test with the file it is in, in path then source order.
 */
export async function scanProject(
  project: TestProject,
): Promise<readonly (ScannedTest & { readonly file: string })[]> {
  const directory: string = path.dirname(project.file);
  // Every framework's attributes when a project names none, as a project marked only by
  // IsTestProject or the test SDK may get its framework from a shared Directory.Build.props.
  const frameworks: readonly DotnetFramework[] =
    project.frameworks.length > 0 ? project.frameworks : ['xUnit', 'NUnit', 'MSTest'];
  const attributes: ReadonlySet<string> = new Set<string>(
    frameworks.flatMap(
      (framework: DotnetFramework): readonly string[] => TEST_ATTRIBUTES[framework],
    ),
  );
  const sources: readonly string[] = await walkFiles(directory, {
    accept: (name: string): boolean => name.endsWith('.cs'),
    skip: new Set<string>(['TestResults']),
  });
  const tests: (ScannedTest & { readonly file: string })[] = [];
  for (const file of sources) {
    const text: string | null = await readSource(file);
    if (text !== null) {
      tests.push(...scanCSharp(text, attributes).map((test: ScannedTest) => ({ ...test, file })));
    }
  }
  return tests;
}

/**
 * Names which framework a test belongs to, from its attributes and its project's references.
 * @param attributes The test's attributes.
 * @param frameworks The project's frameworks.
 * @returns Returns the framework, or undefined when it cannot be told.
 */
function frameworkOf(
  attributes: readonly string[],
  frameworks: readonly DotnetFramework[],
): DotnetFramework | undefined {
  return frameworks.find((framework: DotnetFramework): boolean =>
    attributes.some((attribute: string): boolean => TEST_ATTRIBUTES[framework].includes(attribute)),
  );
}

/**
 * Describes a class's tests while a project's tree is built.
 */
interface ClassEntry {
  readonly line: number;
  readonly file: string;
  readonly tests: TestNode[];
}

/**
 * Finds a folder's tests: a node per test project, then per class, then per test method.
 * @param root The absolute folder.
 * @returns Returns the root nodes.
 */
export async function discoverTests(root: string): Promise<readonly TestNode[]> {
  const nodes: TestNode[] = [];
  for (const project of await findTestProjects(root)) {
    const classes: Map<string, ClassEntry> = new Map<string, ClassEntry>();
    const seen: Set<string> = new Set<string>();
    for (const test of await scanProject(project)) {
      const id: string = `${test.className}.${test.method}`;
      if (seen.has(id)) {
        // An overload shares its name with the method before it; the platform runs both under one.
        continue;
      }
      seen.add(id);
      let entry: ClassEntry | undefined = classes.get(test.className);
      if (entry === undefined) {
        entry = { line: test.classLine, file: test.file, tests: [] };
        classes.set(test.className, entry);
      }
      const framework: DotnetFramework | undefined = frameworkOf(
        test.attributes,
        project.frameworks,
      );
      entry.tests.push({
        id,
        label: test.method,
        kind: 'test',
        ...(framework === undefined || project.frameworks.length < 2 ? {} : { framework }),
        location: { file: test.file, line: test.line },
      });
    }
    nodes.push({
      id: projectId(project.file),
      label: project.name,
      kind: 'project',
      ...(project.frameworks.length > 0 ? { framework: project.frameworks.join(', ') } : {}),
      location: { file: project.file, line: 1 },
      children: [...classes.entries()].map(([className, entry]): TestNode => ({
        id: className,
        label: className,
        kind: 'suite',
        location: { file: entry.file, line: entry.line },
        children: entry.tests,
      })),
    });
  }
  return nodes;
}
