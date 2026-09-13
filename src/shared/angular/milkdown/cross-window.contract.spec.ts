import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Global-document expressions that are wrong in a markdown editor hosted outside the main window.
 * Every modal is a real Electron child window, and the agent composer presents the shared markdown
 * editor in one — there, the global `document` is still the MAIN window's document, so its active
 * element, its body and its event stream all describe the wrong window. Focus checks never hold (or
 * always hold), drag ghosts appear in the window behind the modal, and listeners never fire. The
 * editor and its plugins must resolve these through the DOM they own: `this.dom.ownerDocument`,
 * `view.dom.ownerDocument`.
 *
 * `document.createElement` is deliberately not banned: a created element is adopted into the right
 * document on insertion, so it renders correctly either way.
 */
const FORBIDDEN_GLOBAL_DOCUMENT_USES: readonly string[] = [
  'document.activeElement',
  'document.body',
  'document.addEventListener',
  'document.removeEventListener',
  'document.getSelection',
  'document.defaultView',
];

/**
 * The sources this guards: the shared editor pane and every Milkdown plugin behind it.
 */
const GUARDED_ROOTS: readonly string[] = [
  join(process.cwd(), 'src/shared/angular/milkdown'),
  join(process.cwd(), 'src/shared/angular/components/markdown-editor'),
];

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
 * Strips line comments and block comments from a source, so prose mentioning a forbidden expression
 * does not trip the scan.
 * @param source The TypeScript source text.
 * @returns Returns the source with comments blanked.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Guards the rule a unit test cannot otherwise reach: the shared markdown editor must behave
 * identically whether it is mounted in the main window or in a modal's child window, and jsdom has
 * only one window to test with. The cross-window bugs all had the same shape — an expression on the
 * global `document` that silently described the wrong window — so the sources are held to resolving
 * those expressions through their own DOM instead.
 */
describe('markdown editor cross-window contract', () => {
  it('noEditorSourceReadsTheGlobalDocumentsState_soAModalHostedEditorSeesItsOwnWindow', () => {
    const offenders: string[] = [];
    for (const root of GUARDED_ROOTS) {
      for (const path of sourcesUnder(root)) {
        const source: string = withoutComments(readFileSync(path, 'utf8'));
        for (const forbidden of FORBIDDEN_GLOBAL_DOCUMENT_USES) {
          if (source.includes(forbidden)) {
            offenders.push(`${path.slice(process.cwd().length + 1)} uses ${forbidden}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
