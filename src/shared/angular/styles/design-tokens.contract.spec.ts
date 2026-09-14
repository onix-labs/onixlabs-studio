import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

/**
 * Guards the design-token surface against the two ways it rots, neither of which any other test can
 * see and neither of which shows up as a failure in the application.
 *
 * A **token consumed but never defined** renders as nothing at all. `color: var(--typo-color)` is not
 * an error in CSS — the declaration is simply dropped, and the element inherits. So a renamed or
 * mistyped token produces an element that looks *almost* right, which is the hardest kind of visual
 * bug to notice and the easiest to ship. Only a consumer with no fallback is flagged: `var(--x, red)`
 * has said what it wants to happen.
 *
 * A **theme token defined but never consumed** is dead weight that the next person has to reason
 * about. It also makes every future audit start by re-deriving which of these are intentional, which
 * is the work this file exists to stop repeating (#499, #500).
 *
 * ⚠️ Deliberately a spec rather than a lint rule or a throwaway script. The original audit was a
 * ~120-line script that was run once and discarded, which is why the same three dead tokens survived
 * to be found again months later. Anything that does not run in the gate does not hold.
 *
 * ⛔ This asserts against the *sources*, never through the CSS cascade — `getComputedStyle` refuses in
 * CI, and a token's value is not what is being checked here anyway. Only its existence is.
 */

/**
 * The theme files, which define the tokens the application is themed by.
 */
const THEME_FILES: readonly string[] = [
  'src/shared/angular/styles/_theme-dark.scss',
  'src/shared/angular/styles/_theme-light.scss',
];

/**
 * The tree scanned for definitions and consumers.
 */
const SOURCE_ROOT: string = join(process.cwd(), 'src');

/**
 * The file kinds a custom property can be written in: styles, and the components that carry inline
 * styles or set properties from TypeScript.
 */
const SOURCE_EXTENSIONS: readonly string[] = ['.scss', '.css', '.ts', '.html'];

/**
 * This file's own name, skipped when walking: it names tokens in prose to explain what it checks.
 */
const SELF: string = 'design-tokens.contract.spec.ts';

/**
 * Tokens allowed to be consumed without being defined anywhere in the tree.
 *
 * These are not ours to define. A vendor stylesheet ships its own, and a consumer that sets one is
 * configuring somebody else's component rather than naming a colour of ours.
 */
const EXTERNAL_TOKENS: readonly RegExp[] = [
  /^--xterm-/,
  /^--milkdown-/,
  /^--crepe-/,
  /^--cdk-/,
  /^--mat-/,
  /^--monaco-/,
];

/**
 * ⛔ **These are bugs, not exemptions.** Every one is a real dropped declaration: an invisible border,
 * or text falling back to whatever it inherits. They are listed rather than fixed here because
 * choosing the replacement token changes how something looks, and a guardrail is the wrong change to
 * smuggle a visual decision through. Tracked in #665.
 *
 * The guard's purpose is served either way: nothing *new* can join this list. Delete an entry as it is
 * fixed, and never add one — a new arrival is the bug this file exists to catch.
 */
const KNOWN_MISSING: readonly string[] = [
  '--body-border-color',
  '--form-border-color',
  '--gray-50',
  '--text-color',
  '--text-muted-color',
];

/**
 * Theme tokens allowed to be defined without a consumer.
 *
 * Empty, and worth keeping that way. It was checked when this guard was written: of 91 theme tokens,
 * exactly three had no consumer, and all three were component leftovers rather than palette
 * primitives — so the palette question #499 was raised to settle turned out to have almost nothing in
 * it. Every accent-RGB step and every grey in the scale is consumed. **Keeping the full palette is
 * therefore the recorded policy, because there is no bloat to prune**; if a future primitive is added
 * ahead of its consumer, add it here with the reason rather than deleting the guard.
 */
const INTENTIONALLY_UNCONSUMED: readonly string[] = [];

/**
 * Walks a directory tree for the files a custom property can appear in.
 * @param directory The directory to walk.
 * @returns Returns the absolute paths found.
 */
function sourcesUnder(directory: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path: string = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourcesUnder(path));
      continue;
    }
    // This file names tokens in prose to explain itself, so scanning it would have the guard report
    // its own examples.
    if (SOURCE_EXTENSIONS.includes(extname(entry.name)) && !path.endsWith(SELF)) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Collects every custom property defined anywhere in the tree.
 *
 * Three forms count, because a token is not always written as a CSS declaration:
 *
 *   - `--token: value` — a stylesheet, a theme file, or an inline style.
 *   - `[style.--token]="expression"` — an Angular style binding, which is how a component hands a
 *     measurement to its own stylesheet (`binary-editor` computes bytes-per-row this way).
 *   - `'--token'` in TypeScript — named as a string to `setProperty`, which is how a token that only
 *     the runtime knows the value of is set (`modal-windows` measures the drag band and publishes it).
 *
 * Missing the latter two is not a theoretical gap: both were reported as undefined the first time this
 * guard ran, and both were correct code.
 * @param files The files to read.
 * @returns Returns the defined token names.
 */
function definedTokens(files: readonly string[]): ReadonlySet<string> {
  const defined: Set<string> = new Set<string>();
  for (const file of files) {
    const text: string = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(--[a-z0-9-]+)\s*:/g)) {
      defined.add(match[1]);
    }
    for (const match of text.matchAll(/\[style\.(--[a-z0-9-]+)\]/g)) {
      defined.add(match[1]);
    }
    if (extname(file) === '.ts') {
      for (const match of text.matchAll(/['"`](--[a-z0-9-]+)['"`]/g)) {
        defined.add(match[1]);
      }
    }
  }
  return defined;
}

/**
 * Collects every custom property consumed **without a fallback**. A consumer that supplies one has
 * stated what should happen when the token is absent, so it is not relying on the token existing.
 * @param files The files to read.
 * @returns Returns the token names consumed with no fallback.
 */
function consumedWithoutFallback(files: readonly string[]): ReadonlySet<string> {
  const consumed: Set<string> = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(/var\(\s*(--[a-z0-9-]+)\s*([,)])/g)) {
      if (match[2] === ')') {
        consumed.add(match[1]);
      }
    }
  }
  return consumed;
}

/**
 * Collects every custom property consumed at all, with or without a fallback.
 * @param files The files to read.
 * @returns Returns the token names consumed.
 */
function consumedAtAll(files: readonly string[]): ReadonlySet<string> {
  const consumed: Set<string> = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
      consumed.add(match[1]);
    }
  }
  return consumed;
}

/**
 * Gets whether a token belongs to a third party rather than to us.
 * @param token The token name.
 * @returns Returns true when it is external.
 */
function isExternal(token: string): boolean {
  return EXTERNAL_TOKENS.some((pattern: RegExp): boolean => pattern.test(token));
}

describe('design tokens', () => {
  const files: readonly string[] = sourcesUnder(SOURCE_ROOT);
  const defined: ReadonlySet<string> = definedTokens(files);
  const consumed: ReadonlySet<string> = consumedAtAll(files);

  it('everyTokenConsumedWithoutAFallbackIsDefinedSomewhere', () => {
    // A missing token is not a CSS error: the declaration is dropped and the element inherits, so the
    // symptom is something that looks almost right rather than something that fails.
    const missing: readonly string[] = [...consumedWithoutFallback(files)]
      .filter(
        (token: string): boolean =>
          !defined.has(token) && !isExternal(token) && !KNOWN_MISSING.includes(token),
      )
      .sort();

    expect(missing).toEqual([]);
  });

  it('everyThemeTokenHasAConsumer', () => {
    const themeTokens: ReadonlySet<string> = definedTokens(
      THEME_FILES.map((file: string): string => join(process.cwd(), file)),
    );
    const dead: readonly string[] = [...themeTokens]
      .filter(
        (token: string): boolean =>
          !consumed.has(token) && !INTENTIONALLY_UNCONSUMED.includes(token),
      )
      .sort();

    expect(dead).toEqual([]);
  });

  it('theKnownMissingListDoesNotOutliveItsBugs', () => {
    // An allowlist nobody prunes becomes permanent. Each entry here is a live dropped declaration, so
    // once one is fixed its token starts resolving and the entry is dead weight pointing at nothing.
    const stale: readonly string[] = KNOWN_MISSING.filter((token: string): boolean =>
      defined.has(token),
    ).sort();

    expect(stale).toEqual([]);
  });

  it('theGuardIsActuallyLookingAtSomething', () => {
    // A tripwire, so this file cannot pass by scanning nothing — the failure mode of every source-scan
    // guard, and invisible precisely when it matters.
    expect(files.length).toBeGreaterThan(100);
    expect(defined.size).toBeGreaterThan(50);
    expect(consumed.size).toBeGreaterThan(50);
  });
});
