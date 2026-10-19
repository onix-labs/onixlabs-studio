import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MONACO_TRIGGER_PARAMETER_HINTS_COMMAND,
  MONACO_TRIGGER_SUGGEST_COMMAND,
  PARAMETER_HINTS_CONTRIBUTION,
  PARAMETER_HINTS_HOOKS,
  SUGGEST_CONTRIBUTION,
  SUGGEST_HOOKS,
  WORD_BASED_PROVIDER_NAME,
} from './monaco-suggest-commands';

/**
 * The Monaco build the application loads at run time: `angular.json` copies it to `vs/`.
 */
const MONACO_BUILD: string = join(process.cwd(), 'node_modules/monaco-editor/min/vs');

/**
 * Reads every script of Monaco's build.
 * @returns Returns their sources.
 */
function sources(): string[] {
  return readdirSync(MONACO_BUILD)
    .filter((name: string): boolean => name.endsWith('.js'))
    .map((name: string): string => readFileSync(join(MONACO_BUILD, name), 'utf8'));
}

/**
 * Takes the class a contribution is declared on out of Monaco's minified build: from the class
 * declaration nearest before the contribution's `ID` assignment (a static assigned after the class
 * body) to that assignment. The identifier appears elsewhere too — where other code reaches the
 * contribution — so the assignment, not the bare string, marks the class.
 * @param id The contribution's identifier.
 * @returns Returns the class's source, or an empty string when no file declares it.
 */
function classDeclaring(id: string): string {
  for (const source of sources()) {
    const at: number = source.indexOf(`.ID="${id}"`);
    if (at >= 0) {
      const start: number = source.lastIndexOf('=class', at);
      return start < 0 ? '' : source.slice(start, at);
    }
  }
  return '';
}

/**
 * Determines whether a minified class body uses a member: defines it as a method, assigns it on
 * `this`, or reads or calls it on something.
 * @param body The class body.
 * @param member The member's name.
 * @returns Returns true when it does.
 */
function uses(body: string, member: string): boolean {
  return new RegExp(
    `(?:[;}]\\s*(?:async\\s+)?${member}\\(|this\\.${member}=|\\.${member}\\b)`,
  ).test(body);
}

/**
 * Guards the takeover of Monaco's suggest and parameter-hints widgets (#1021) against a Monaco
 * upgrade. The takeover replaces each contribution's widget — a member its constructor assigns — and
 * calls members of each by name; the unit specs use stand-ins, so they cannot see a rename. This spec
 * reads the build the application really loads, and fails when a member the takeover relies on is
 * gone — rather than Monaco's widget coming back, or the list going dead, after an upgrade.
 */
describe('Monaco suggest hooks (#1021)', () => {
  it.each([
    [SUGGEST_CONTRIBUTION, SUGGEST_HOOKS],
    [PARAMETER_HINTS_CONTRIBUTION, PARAMETER_HINTS_HOOKS],
  ])('%s_stillUsesEveryMemberTheTakeoverRelieson', (id: string, hooks: readonly string[]) => {
    const body: string = classDeclaring(id);

    expect(body.length).toBeGreaterThan(0);
    for (const hook of hooks) {
      expect(uses(body, hook), hook).toBe(true);
    }
  });

  it('theSuggestContribution_stillBuildsItsWidgetInTheIdleValueTheTakeoverReplaces', () => {
    const body: string = classDeclaring(SUGGEST_CONTRIBUTION);

    // `this.widget=this._toDispose.add(new <IdleValue>(…getDomNode()…), () => …)`: an idle value,
    // built at window idle — which the takeover cancels by disposing it.
    expect(/this\.widget=this\._toDispose\.add\(new [\w$.]+\(/.test(body)).toBe(true);
    // The widget the takeover's stand-in answers for is read through `.value`.
    expect(body.includes('this.widget.value.showSuggestions(')).toBe(true);
  });

  it('theParameterHintsContribution_stillBuildsItsWidgetLazily', () => {
    const body: string = classDeclaring(PARAMETER_HINTS_CONTRIBUTION);

    expect(/this\.widget=new [\w$.]+\(/.test(body)).toBe(true);
    expect(body.includes('this.widget.rawValue?.hide()')).toBe(true);
  });

  it('theWordBasedProvider_andTheTypingEvent_stillHaveTheirNames', () => {
    const all: string = sources().join('\n');

    expect(all.includes(`_debugDisplayName="${WORD_BASED_PROVIDER_NAME}"`)).toBe(true);
    // Commit characters follow the editor's typing through this event, as Monaco's own did.
    expect(all.includes('onWillType')).toBe(true);
  });

  it('theCommandsWhoseChordsAreRemoved_stillExist', () => {
    const all: string = sources().join('\n');

    for (const command of [
      MONACO_TRIGGER_SUGGEST_COMMAND,
      MONACO_TRIGGER_PARAMETER_HINTS_COMMAND,
    ]) {
      expect(all.includes(`"${command}"`), command).toBe(true);
    }
  });
});
