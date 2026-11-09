// Builds the `cargo test` command a run asks for (#1356).
//
// One command per run, as the protocol has it. Tests in one crate run with that crate's manifest; tests
// in several crates of one workspace run once, from the workspace, with a `-p` per crate. A selection is
// passed to libtest as exact names, and narrowed to one target with `--lib`, `--bin` or `--test` when
// every selected test is in it, so nothing else is built or run.
import * as path from 'node:path';
import type { TestCommand } from '../../protocol/testing/protocol';
import { CargoTarget, Crate } from './cargo';
import { RustDiscovery, RustTest } from './discover';

/**
 * Finds the manifest one command can run every given crate from: the crate's own when there is one,
 * else the workspace they all belong to.
 * @param crates The crates.
 * @returns Returns the manifest, or null when they share no workspace.
 */
function commonManifest(crates: readonly Crate[]): string | null {
  if (crates.length === 1) {
    return crates[0].manifest;
  }
  const workspaces: ReadonlySet<string> = new Set<string>(
    crates.map((crate: Crate): string => crate.workspace ?? crate.manifest),
  );
  return workspaces.size === 1 ? [...workspaces][0] : null;
}

/**
 * Resolves the tests a run names: a test stands for itself, a crate, file or module for every test
 * under it.
 * @param discovery What discovery found.
 * @param ids The node identifiers asked for, empty for every test.
 * @returns Returns the tests, and the crates asked for whole.
 */
export function resolveSelection(
  discovery: RustDiscovery,
  ids: readonly string[],
): { readonly tests: readonly RustTest[]; readonly wholeCrates: readonly Crate[] } {
  const tests: Map<string, RustTest> = new Map<string, RustTest>();
  const whole: Map<string, Crate> = new Map<string, Crate>();
  for (const id of ids) {
    const crate: Crate | undefined = discovery.crates.find(
      (candidate: Crate): boolean => candidate.name === id,
    );
    if (crate !== undefined) {
      whole.set(crate.name, crate);
      continue;
    }
    const test: RustTest | undefined = discovery.tests.get(id);
    if (test !== undefined) {
      tests.set(id, test);
      continue;
    }
    // A file or module stands for the tests that run without asking; an ignored one runs only when it
    // is picked itself, as `cargo test` would have it.
    for (const member of discovery.groups.get(id) ?? []) {
      const found: RustTest | undefined = discovery.tests.get(member);
      if (found !== undefined && !found.ignored) {
        tests.set(member, found);
      }
    }
  }
  return { tests: [...tests.values()], wholeCrates: [...whole.values()] };
}

/**
 * Builds the command for a run.
 * @param root The folder.
 * @param discovery What discovery found.
 * @param ids The node identifiers asked for, empty for every test.
 * @returns Returns the command.
 * @throws When the tests asked for are in crates no single command can run.
 */
export function cargoTestCommand(
  root: string,
  discovery: RustDiscovery,
  ids: readonly string[],
): TestCommand {
  const { tests, wholeCrates } = resolveSelection(discovery, ids);
  const everything: boolean = ids.length === 0;
  const crates: readonly Crate[] = everything
    ? discovery.crates
    : [
        ...new Map<string, Crate>(
          [...wholeCrates, ...tests.map((test: RustTest): Crate => test.crate)].map(
            (crate: Crate): [string, Crate] => [crate.name, crate],
          ),
        ).values(),
      ];
  if (crates.length === 0) {
    throw new Error(
      ids.length === 0 ? 'There are no crates in this folder.' : 'None of those tests was found.',
    );
  }
  const manifest: string | null = commonManifest(crates);
  if (manifest === null) {
    throw new Error(
      'Those tests are in crates that share no workspace, so one cargo command cannot run them. Run one crate at a time.',
    );
  }
  const args: string[] = ['test', '--manifest-path', manifest, '--no-fail-fast'];
  const ownManifest: boolean = crates.length === 1 && crates[0].manifest === manifest;
  if (everything && !ownManifest) {
    args.push('--workspace');
  } else if (!ownManifest) {
    for (const crate of crates) {
      args.push('-p', crate.name);
    }
  }
  // A whole crate runs unfiltered; so, then, does everything run alongside it in this command.
  const filtered: boolean = !everything && wholeCrates.length === 0;
  if (filtered) {
    const targets: ReadonlySet<string> = new Set<string>(
      tests.map(
        (test: RustTest): string => `${test.crate.name}\u0000${JSON.stringify(test.target)}`,
      ),
    );
    if (targets.size === 1) {
      const target: CargoTarget = tests[0].target;
      args.push(...(target.kind === 'lib' ? ['--lib'] : [`--${target.kind}`, target.name]));
    }
    args.push('--', '--exact');
    // An ignored test the user picked is one they mean to run; the selection holds no other.
    if (tests.some((test: RustTest): boolean => test.ignored)) {
      args.push('--include-ignored');
    }
    args.push(...new Set<string>(tests.map((test: RustTest): string => test.path)));
  }
  const title: string =
    crates.length === 1
      ? `Test ${crates[0].name}`
      : `Test ${path.basename(path.dirname(manifest))}`;
  return { executable: 'cargo', args, cwd: path.dirname(manifest) || root, title };
}
