import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards one rule: **the terminal panel does not tell `app-terminal` how to lay itself out.**
 *
 * 🔥 It did, and the terminal's bottom rows were cut off for everyone who used the panel while the
 * standalone terminal view was fine. The rule was `app-terminal { display: block; … }`, which Angular
 * compiles to `app-terminal[_ngcontent-…]` — specificity (0,1,1) — while the component's own
 * `:host { display: flex; flex-direction: column; }` compiles to `[_nghost-…]` at (0,1,0). The consumer
 * won. Inside the panel the terminal was a block, so `.terminal { flex: 1; min-block-size: 0 }` went
 * inert, the xterm host took its content height instead of the space available, and the last rows sat
 * below the padding box. `fitToHost` then measured that content-driven height and had nothing to shrink
 * against, so it never recovered.
 *
 * ⚠️ Deliberately a source scan. The failure is a specificity race between two stylesheets, which is
 * only observable through the resolved cascade — and this suite's environment refuses to resolve it
 * (`getComputedStyle` does not apply author styles under jsdom, and CI has burned on that before). A
 * scan costs nothing and fails loudly the moment a consumer reaches back in.
 *
 * ⛔ This checks a *decision*, not a spelling: a panel sizes the slot it puts a component in, never the
 * component. Sizing belongs on `.terminal-panel__bodies` and `.terminal-panel__body`, which are the
 * panel's own boxes. If those are renamed, move the assertion; do not delete it.
 */

/**
 * The stylesheet under contract.
 */
const STYLESHEET: string =
  'src/shared/angular/components/panels/terminal-panel/terminal-panel.scss';

/**
 * Reads a repository file. Resolved from the working directory rather than from `import.meta.url`,
 * because a spec is transformed and its module URL is not a path on disk under every runner config.
 * @param relativePath The repository-relative path.
 * @returns Returns the file's contents.
 */
function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

/**
 * Extracts the declarations of a rule, from its selector to the brace that closes it.
 * @param text The stylesheet's contents.
 * @param selector The selector to find, at the start of a line.
 * @returns Returns the declarations, or null when the rule is absent.
 */
function ruleBody(text: string, selector: string): string | null {
  const start: number = text.indexOf(`\n${selector} {`);
  if (start < 0) {
    return null;
  }
  const end: number = text.indexOf('\n}', start);
  return end > start ? text.slice(start, end) : null;
}

describe('terminal panel layout', () => {
  it('doesNotStyleTheTerminalComponentItHosts', () => {
    // The panel owns the box; the terminal owns everything inside it. A consumer rule wins the
    // cascade against the component's own `:host`, so any declaration here silently overrides the
    // component — and `display` in particular decides whether its children can lay out at all.
    expect(ruleBody(source(STYLESHEET), 'app-terminal')).toBeNull();
  });

  it('sizesItsOwnBoxesInstead', () => {
    // The counterpart to the rule above: the panel is still responsible for giving the terminal a box
    // with a real height, and it does that on boxes it owns.
    const text: string = source(STYLESHEET);

    expect(ruleBody(text, '.terminal-panel__bodies')).toContain('min-block-size: 0');
    expect(ruleBody(text, '.terminal-panel__body')).toContain('inset: 0');
  });
});
