import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONTENT_HOVER_CONTRIBUTION,
  CONTENT_HOVER_HOOKS,
  GLYPH_HOVER_CONTRIBUTION,
  GLYPH_HOVER_HOOKS,
  MARKER_CONTRIBUTION,
  MARKER_HOOKS,
  MONACO_MARKER_COMMANDS,
  MONACO_SHOW_HOVER_COMMAND,
} from './monaco-hover-commands';

/**
 * The Monaco build the application loads at run time: `angular.json` copies it to `vs/`.
 */
const MONACO_BUILD: string = join(process.cwd(), 'node_modules/monaco-editor/min/vs');

/**
 * Finds the file of Monaco's build that defines a contribution, and returns its source.
 * @param id The contribution's identifier.
 * @returns Returns the source, or an empty string when no file defines it.
 */
function sourceDefining(id: string): string {
  for (const name of readdirSync(MONACO_BUILD)) {
    if (!name.endsWith('.js')) {
      continue;
    }
    const source: string = readFileSync(join(MONACO_BUILD, name), 'utf8');
    if (source.includes(`"${id}"`)) {
      return source;
    }
  }
  return '';
}

/**
 * Takes the class a contribution identifier is declared on out of a minified source: from the class
 * declaration nearest before the identifier to the identifier itself (the identifier is assigned as a
 * static after the class body, so the body lies between the two).
 * @param source The minified source.
 * @param id The contribution's identifier.
 * @returns Returns the class's source.
 */
function classBefore(source: string, id: string): string {
  const at: number = source.indexOf(`"${id}"`);
  const start: number = source.lastIndexOf('=class', at);
  return start < 0 || at < 0 ? '' : source.slice(start, at);
}

/**
 * Guards the takeover of Monaco's hover, gutter hover and problem peek (#1020) against a Monaco
 * upgrade. The takeover replaces private members of Monaco's contributions by name; the unit specs
 * use stand-ins, so they cannot see a rename. This spec reads the build the application really loads,
 * and fails when a member the takeover replaces is no longer a method of its contribution — rather
 * than the takeover quietly finding nothing to replace and Monaco's widgets coming back.
 */
describe('Monaco hover hooks (#1020)', () => {
  it.each([
    [CONTENT_HOVER_CONTRIBUTION, CONTENT_HOVER_HOOKS],
    [GLYPH_HOVER_CONTRIBUTION, GLYPH_HOVER_HOOKS],
    [MARKER_CONTRIBUTION, MARKER_HOOKS],
  ])('%s_stillHasEveryMethodTheTakeoverReplaces', (id: string, hooks: readonly string[]) => {
    const body: string = classBefore(sourceDefining(id), id);

    expect(body.length).toBeGreaterThan(0);
    for (const hook of hooks) {
      // A method in a minified class body: its name straight after the end of the member before it.
      expect(new RegExp(`[;}]\\s*(?:async\\s+)?${hook}\\(`).test(body), hook).toBe(true);
    }
  });

  it('theCommandsWhoseChordsAreRemoved_stillExist', () => {
    const source: string = sourceDefining(CONTENT_HOVER_CONTRIBUTION);

    for (const command of [MONACO_SHOW_HOVER_COMMAND, ...MONACO_MARKER_COMMANDS]) {
      expect(source.includes(`"${command}"`), command).toBe(true);
    }
  });
});
