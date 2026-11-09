import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  compileWatchPattern,
  globToRegExp,
  matchesAny,
  WatchRegistrations,
} from './lsp-watch-glob';

describe('lsp-watch-glob', () => {
  /**
   * Tests a single glob against a path.
   * @param glob The glob.
   * @param relativePath The path.
   * @returns Returns whether it matches.
   */
  function matches(glob: string, relativePath: string): boolean {
    return matchesAny(relativePath, [globToRegExp(glob)]);
  }

  it('star_matchesWithinASegmentOnly', () => {
    expect(matches('*.ts', 'a.ts')).toBe(true);
    expect(matches('*.ts', 'src/a.ts')).toBe(false);
  });

  it('doubleStar_matchesAnyDepthIncludingNone', () => {
    // The shape every server registers: rust-analyzer's `**/Cargo.toml`, gopls's `**/*.go`.
    expect(matches('**/*.ts', 'a.ts')).toBe(true);
    expect(matches('**/*.ts', 'src/deep/a.ts')).toBe(true);
    expect(matches('**/Cargo.toml', 'crates/x/Cargo.toml')).toBe(true);
    expect(matches('**/*.ts', 'src/a.rs')).toBe(false);
  });

  it('trailingDoubleStar_matchesEverythingBeneath', () => {
    expect(matches('src/**', 'src/a/b/c.txt')).toBe(true);
    expect(matches('src/**', 'lib/a.txt')).toBe(false);
  });

  it('braces_expandAlternatives', () => {
    // vscode-langservers register `**/*.{json,jsonc}`; tsserver `**/*.{ts,tsx,js,jsx}`.
    expect(matches('**/*.{ts,tsx}', 'a.tsx')).toBe(true);
    expect(matches('**/*.{ts,tsx}', 'a.js')).toBe(false);
  });

  it('questionMark_matchesOneCharacter', () => {
    expect(matches('a?.ts', 'ab.ts')).toBe(true);
    expect(matches('a?.ts', 'abc.ts')).toBe(false);
  });

  it('characterClass_isPassedThrough', () => {
    expect(matches('[ab].ts', 'a.ts')).toBe(true);
    expect(matches('[ab].ts', 'c.ts')).toBe(false);
  });

  it('literalDotsAndBackslashesAreHandled', () => {
    expect(matches('**/go.mod', 'go.mod')).toBe(true);
    expect(matches('**/go.mod', 'goxmod')).toBe(false);
    expect(matches('**/*.cs', 'src\\Program.cs')).toBe(true);
  });

  it('matchesAny_isFalseWithNoMatchers', () => {
    expect(matchesAny('a.ts', [])).toBe(false);
  });
});

describe('compileWatchPattern', () => {
  const root: string = path.resolve('/work/aero');
  const uri: (...parts: string[]) => string = (...parts: string[]): string =>
    pathToFileURL(path.join(root, ...parts)).href;
  const test: (glob: unknown, relativePath: string) => boolean = (
    glob: unknown,
    relativePath: string,
  ): boolean => {
    const matcher: RegExp | null = compileWatchPattern(glob, root);
    return matcher !== null && matchesAny(relativePath, [matcher]);
  };

  it('aPlainString_isRelativeToTheRoot', () => {
    expect(test('**/*.cs', 'Core/A.cs')).toBe(true);
  });

  it('aRelativePattern_isRelativeToItsBaseFolder', () => {
    // Roslyn: `{ baseUri: <project folder>, pattern: '**/*{.cs,.razor,.cshtml}' }`.
    const glob: unknown = { baseUri: uri('OnixLabs.Core'), pattern: '**/*{.cs,.razor,.cshtml}' };
    expect(test(glob, 'OnixLabs.Core/Deep/A.cs')).toBe(true);
    expect(test(glob, 'OnixLabs.Core/A.razor')).toBe(true);
    expect(test(glob, 'OnixLabs.Other/A.cs')).toBe(false);
    // Before #1170 the base was dropped, so this matched only at the root.
    expect(
      test(
        { baseUri: uri('X', 'obj'), pattern: 'project.assets.json' },
        'X/obj/project.assets.json',
      ),
    ).toBe(true);
    expect(
      test({ baseUri: uri('X', 'obj'), pattern: 'project.assets.json' }, 'project.assets.json'),
    ).toBe(false);
  });

  it('aBaseThatIsTheRoot_orAWorkspaceFolder_works', () => {
    expect(test({ baseUri: uri(), pattern: '.editorconfig' }, '.editorconfig')).toBe(true);
    expect(test({ baseUri: { uri: uri(), name: 'aero' }, pattern: '*.slnx' }, 'aero.slnx')).toBe(
      true,
    );
  });

  it('aBaseFolderNamedLikeGlobSyntax_isTakenLiterally', () => {
    const glob: unknown = { baseUri: uri('[draft]'), pattern: '*.cs' };
    expect(test(glob, '[draft]/A.cs')).toBe(true);
    expect(test(glob, 'd/A.cs')).toBe(false);
  });

  it('aBaseOrAbsoluteGlobOutsideTheRoot_namesNothing', () => {
    // Roslyn also watches analyser configs in the .NET SDK; the root watcher cannot see them.
    expect(
      compileWatchPattern(
        { baseUri: 'file:///usr/local/share/dotnet/sdk', pattern: '*.globalconfig' },
        root,
      ),
    ).toBeNull();
    expect(compileWatchPattern('/elsewhere/**/*.cs', root)).toBeNull();
    expect(test(path.join(root, '**', '*.cs'), 'Core/A.cs')).toBe(true);
  });

  it('malformedInput_namesNothing', () => {
    expect(compileWatchPattern(42, root)).toBeNull();
    expect(compileWatchPattern({ baseUri: uri() }, root)).toBeNull();
    expect(compileWatchPattern({ baseUri: 'file://%', pattern: '*' }, root)).toBeNull();
  });
});

describe('WatchRegistrations', () => {
  const root: string = path.resolve('/work/aero');
  const watcher: (folder: string, pattern: string) => unknown = (
    folder: string,
    pattern: string,
  ): unknown => ({
    globPattern: { baseUri: pathToFileURL(path.join(root, folder)).href, pattern },
  });

  it('isNull_untilSomethingIsRegistered_soEverythingIsReported', () => {
    expect(new WatchRegistrations(root).patterns()).toBeNull();
  });

  it('keepsEveryRegistration_andAnswersTheirUnion (#1170)', () => {
    // Roslyn registers once per project per kind of file; keeping only the last left one project's
    // obj/project.assets.json as the only thing watched.
    const registrations: WatchRegistrations = new WatchRegistrations(root);
    registrations.register('a', [watcher('A', '**/*.cs')]);
    registrations.register('b', [watcher('B', '**/*.cs')]);
    registrations.register('c', [watcher('B/obj', 'project.assets.json')]);

    const patterns: readonly RegExp[] = registrations.patterns() ?? [];
    expect(matchesAny('A/X.cs', patterns)).toBe(true);
    expect(matchesAny('B/Y.cs', patterns)).toBe(true);
    expect(matchesAny('B/obj/project.assets.json', patterns)).toBe(true);
    expect(registrations.size).toBe(3);
  });

  it('unregistersById_leavingTheOthers', () => {
    const registrations: WatchRegistrations = new WatchRegistrations(root);
    registrations.register('a', [watcher('A', '**/*.cs')]);
    registrations.register('b', [watcher('B', '**/*.cs')]);

    expect(registrations.unregister('a')).toBe(true);
    expect(registrations.unregister('missing')).toBe(false);
    const patterns: readonly RegExp[] = registrations.patterns() ?? [];
    expect(matchesAny('A/X.cs', patterns)).toBe(false);
    expect(matchesAny('B/Y.cs', patterns)).toBe(true);

    registrations.unregister('b');
    expect(registrations.patterns()).toBeNull();
  });

  it('aRegistrationWhollyOutsideTheRoot_reportsNothing_ratherThanEverything', () => {
    const registrations: WatchRegistrations = new WatchRegistrations(root);
    registrations.register('sdk', [
      { globPattern: { baseUri: 'file:///usr/local/share/dotnet/sdk', pattern: '*.globalconfig' } },
    ]);

    expect(registrations.patterns()).toEqual([]);
  });

  it('reRegisteringAnId_replacesOnlyThatRegistration', () => {
    const registrations: WatchRegistrations = new WatchRegistrations(root);
    registrations.register('a', [watcher('A', '**/*.cs')]);
    registrations.register('a', [watcher('A', '**/*.razor')]);

    const patterns: readonly RegExp[] = registrations.patterns() ?? [];
    expect(matchesAny('A/X.cs', patterns)).toBe(false);
    expect(matchesAny('A/X.razor', patterns)).toBe(true);
  });
});
