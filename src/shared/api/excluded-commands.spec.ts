import { describe, expect, it } from 'vitest';
import {
  excludedCommandMatches,
  isExcludedCommand,
  isValidExcludedCommand,
  looksLikeSandboxCrash,
  normaliseExcludedCommand,
  sanitizeExcludedCommands,
  suggestExcludedCommand,
} from './excluded-commands';

describe('excluded commands', () => {
  it('normalise_collapsesWhitespace_andWritesAPrefixWithoutASpaceBeforeTheColon', () => {
    expect(normaliseExcludedCommand('  npx   ng :*  ')).toBe('npx ng:*');
    expect(normaliseExcludedCommand('make  build')).toBe('make build');
  });

  it.each([['*'], [':*'], [''], ['  '], ['npx * build'], ['a'.repeat(201)], ['bad\nline']])(
    'isValid_refusesAPatternThatNamesNoCommandOrCouldBeReadTwoWays %#',
    (pattern: string) => {
      expect(isValidExcludedCommand(pattern)).toBe(false);
    },
  );

  it('isValid_acceptsAnExactCommandAndAPrefix', () => {
    expect(isValidExcludedCommand('make build')).toBe(true);
    expect(isValidExcludedCommand('npx ng:*')).toBe(true);
  });

  it('sanitize_keepsOnlyValidCanonicalPatterns_once', () => {
    expect(sanitizeExcludedCommands(['npx ng :*', 'npx ng:*', '*', 7, null, 'dotnet:*'])).toEqual([
      'npx ng:*',
      'dotnet:*',
    ]);
    expect(sanitizeExcludedCommands('npx ng:*')).toEqual([]);
  });

  it('matches_aPrefixOnAWordBoundary_andAnExactCommandOnlyExactly', () => {
    expect(excludedCommandMatches('npx ng test --watch=false', 'npx ng:*')).toBe(true);
    expect(excludedCommandMatches('npx ng', 'npx ng:*')).toBe(true);
    // `npx ngrok` is not `npx ng`: the prefix ends at a word.
    expect(excludedCommandMatches('npx ngrok http 80', 'npx ng:*')).toBe(false);
    expect(excludedCommandMatches('make build', 'make build')).toBe(true);
    expect(excludedCommandMatches('make build all', 'make build')).toBe(false);
    expect(isExcludedCommand('  dotnet   build ', ['make:*', 'dotnet:*'])).toBe(true);
  });

  it('looksLikeSandboxCrash_readsTheLoadersAndTheAbortsSignatures', () => {
    expect(looksLikeSandboxCrash('dyld[123]: Library not loaded')).toBe(true);
    expect(looksLikeSandboxCrash('Abort trap: 6')).toBe(true);
    expect(looksLikeSandboxCrash('killed by SIGABRT')).toBe(true);
    expect(looksLikeSandboxCrash('Trace/BPT trap: 5')).toBe(true);
    expect(looksLikeSandboxCrash('npm ERR! missing script')).toBe(false);
  });

  it('suggest_takesTheCommand_orTheLauncherAndItsTool', () => {
    expect(suggestExcludedCommand('dotnet build -c Release')).toBe('dotnet:*');
    expect(suggestExcludedCommand('npx ng test --watch=false')).toBe('npx ng:*');
    expect(suggestExcludedCommand('npm run build:electron')).toBe('npm run:*');
    expect(suggestExcludedCommand('CI=1 npx ng build && echo done')).toBe('npx ng:*');
    expect(suggestExcludedCommand('npx --yes ng build')).toBe('npx:*');
    expect(suggestExcludedCommand('   ')).toBeNull();
  });
});
