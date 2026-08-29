import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The accelerators the platform's own editing commands own. The core menu carries each exactly once,
 * as a native role; no feature may bind any of them.
 */
const EDITING_ACCELERATORS: readonly string[] = [
  'CmdOrCtrl+Z',
  'CmdOrCtrl+Shift+Z',
  'CmdOrCtrl+X',
  'CmdOrCtrl+C',
  'CmdOrCtrl+V',
  'CmdOrCtrl+A',
];

/**
 * The feature tree, whose menu contributions this guards.
 */
const FEATURES_ROOT: string = join(process.cwd(), 'src/features');

/**
 * Walks a directory tree for TypeScript sources, skipping specs.
 * @param directory The directory to walk.
 * @returns Returns the absolute paths of the sources found.
 */
function sourcesUnder(directory: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path: string = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourcesUnder(path));
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Guards the one rule that keeps copy and paste working, and the one that unit tests cannot otherwise
 * reach.
 *
 * On macOS the application menu is the ONLY thing binding ⌘X/⌘C/⌘V into the renderer at all, and a
 * menu accelerator is consumed BEFORE the renderer sees the keydown. The core menu therefore carries
 * the editing commands once, as native roles, which Chromium routes to whatever holds focus — so each
 * control serves its own chord. But a later contribution claiming the same accelerator REPLACES the
 * core's entry (`AppMenu.withoutClaimed`), so a single feature entry binding ⌘C silently takes the
 * chord from every text box, editor and terminal on that tab and runs the tab's own command instead.
 *
 * That is exactly what happened three times over, and every round's unit tests passed while the app
 * was broken — because a jsdom test cannot see the native-menu path at all. This spec can: it reads
 * the feature sources and fails if any of them so much as mentions one of these accelerators. A
 * feature wanting a clipboard command puts it on a ribbon button (an explicit instruction to act on
 * that view) and leaves the chord alone.
 */
describe('feature menu editing chords', () => {
  it('noFeatureBindsAnEditingAccelerator_soTheCoreNativeRolesAreNeverReplaced', () => {
    const offenders: string[] = [];
    for (const path of sourcesUnder(FEATURES_ROOT)) {
      const source: string = readFileSync(path, 'utf8');
      for (const accelerator of EDITING_ACCELERATORS) {
        if (source.includes(`'${accelerator}'`)) {
          offenders.push(`${path.slice(process.cwd().length + 1)} binds ${accelerator}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
