import { describe, expect, it } from 'vitest';
import { excludedCommandsOf, isExcludedCommand } from './excluded-commands';

describe('excluded commands, as the harness reads them', () => {
  it('excludedCommandsOf_keepsTheExactAndPrefixPatterns_andDropsTheRest', () => {
    expect(
      excludedCommandsOf({
        excludedCommands: ['npx ng:*', 'make  build', '*', ':*', 'a * b', 7 as never, 'npx ng:*'],
      }),
    ).toEqual(['npx ng:*', 'make build']);
  });

  it('excludedCommandsOf_readsNothing_fromAStudioThatSendsNone', () => {
    expect(excludedCommandsOf({})).toEqual([]);
    expect(excludedCommandsOf({ excludedCommands: 'npx ng:*' as never })).toEqual([]);
  });

  it('isExcludedCommand_matchesAPrefixOnAWord_andAnExactCommandExactly', () => {
    expect(isExcludedCommand('npx ng test', ['npx ng:*'])).toBe(true);
    expect(isExcludedCommand('npx ngrok', ['npx ng:*'])).toBe(false);
    expect(isExcludedCommand('make build', ['make build'])).toBe(true);
    expect(isExcludedCommand('make build all', ['make build'])).toBe(false);
  });
});
