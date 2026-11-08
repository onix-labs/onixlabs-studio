// Builds the `go test` command a run asks for (#1357).
//
// One command per run, from the module's folder: `go test -v -count=1`, the packages, and a `-run`
// naming the selected tests exactly. `-count=1` because a cached result would report a run that did not
// happen; `-v` because the verbose lines are what the results are read from.
import * as path from 'node:path';
import type { TestCommand } from '../../protocol/testing/protocol';
import { GoDiscovery, GoModule, GoPackage, GoTest } from './discover';

/**
 * Names a package the way `go test` takes it from the module's folder: `./cart`, or `.` for the root.
 * @param pkg The package.
 * @returns Returns the pattern.
 */
function packagePattern(pkg: GoPackage): string {
  const relative: string = path
    .relative(pkg.module.directory, pkg.directory)
    .split(path.sep)
    .join('/');
  return relative.length === 0 ? '.' : `./${relative}`;
}

/**
 * Builds the command for a run.
 * @param discovery What discovery found.
 * @param ids The node identifiers asked for — a module, a package, a test or a subtest — empty for all.
 * @returns Returns the command.
 * @throws When the tests asked for are in several modules, which one command cannot run.
 */
export function goTestCommand(discovery: GoDiscovery, ids: readonly string[]): TestCommand {
  const whole: Map<string, GoPackage> = new Map<string, GoPackage>();
  const picked: Map<string, GoTest> = new Map<string, GoTest>();
  const modules: Set<GoModule> = new Set<GoModule>();
  for (const id of ids) {
    const module: GoModule | undefined = discovery.modules.find(
      (candidate: GoModule): boolean => `module:${candidate.path}` === id,
    );
    if (module !== undefined) {
      modules.add(module);
      continue;
    }
    const pkg: GoPackage | undefined = discovery.packages.get(id);
    if (pkg !== undefined) {
      whole.set(pkg.importPath, pkg);
      continue;
    }
    // A subtest runs with its test: `-run` matches level by level, and its siblings are cheap.
    const hash: number = id.indexOf('#');
    const test: GoTest | undefined =
      hash < 0
        ? undefined
        : discovery.tests.get(id.slice(0, hash) + id.slice(hash).replace(/\/.*$/, ''));
    if (test !== undefined) {
      picked.set(test.id, test);
    }
  }
  for (const pkg of [
    ...whole.values(),
    ...[...picked.values()].map((test: GoTest): GoPackage => test.pkg),
  ]) {
    modules.add(pkg.module);
  }
  if (ids.length === 0) {
    for (const module of discovery.modules) {
      modules.add(module);
    }
  }
  if (modules.size === 0) {
    throw new Error(
      ids.length === 0
        ? 'There are no Go modules in this folder.'
        : 'None of those tests was found.',
    );
  }
  if (modules.size > 1) {
    throw new Error(
      'Those tests are in several Go modules, so one go test cannot run them. Run one module at a time.',
    );
  }
  const module: GoModule = [...modules][0];
  const args: string[] = ['test', '-v', '-count=1'];
  const wholeModule: boolean = ids.length === 0 || ids.includes(`module:${module.path}`);
  if (wholeModule) {
    args.push('./...');
  } else {
    // A whole package runs unfiltered; so, then, does everything run alongside it in this command.
    if (whole.size === 0) {
      const names: readonly string[] = [
        ...new Set<string>([...picked.values()].map((test: GoTest): string => test.name)),
      ];
      args.push('-run', `^(${names.join('|')})$`);
    }
    args.push(
      ...new Set<string>(
        [...whole.values(), ...[...picked.values()].map((test: GoTest): GoPackage => test.pkg)].map(
          packagePattern,
        ),
      ),
    );
  }
  return { executable: 'go', args, cwd: module.directory, title: `Test ${module.path}` };
}
