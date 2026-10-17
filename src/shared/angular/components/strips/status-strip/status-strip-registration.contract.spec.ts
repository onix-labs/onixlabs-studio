import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The folder every feature lives under, read from the working directory so the coverage run (which
 * resolves sources elsewhere) finds the same files.
 */
const FEATURES_ROOT: string = join(process.cwd(), 'src', 'features');

/**
 * Lists every TypeScript source under a folder, specs excluded.
 * @param folder The folder to walk.
 * @returns Returns the absolute paths.
 */
function sourcesUnder(folder: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(folder)) {
    const path: string = join(folder, name);
    if (statSync(path).isDirectory()) {
      files.push(...sourcesUnder(path));
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) {
      files.push(path);
    }
  }
  return files;
}

/**
 * Guards the other half of a feature's status (#882): declaring a status component is not enough.
 *
 * The window strip mounts a feature's status through the active view's own injector, which the view
 * publishes with `createViewInjectorRegistrar`. A view that never does leaves the strip nothing to
 * mount through, and it falls back to naming the tab, silently: the Plugin Manager's status went unseen
 * that way. So every feature that declares a `status` must register a view's injector somewhere — the
 * declared view itself, or one it hosts (the workspace's host wraps the directory view that does).
 */
describe('status strip registration contract', () => {
  const features: string[] = readdirSync(FEATURES_ROOT).filter((name: string): boolean =>
    statSync(join(FEATURES_ROOT, name)).isDirectory(),
  );

  for (const feature of features) {
    const sources: string[] = sourcesUnder(join(FEATURES_ROOT, feature));
    const descriptor: string | undefined = sources
      .filter((file: string): boolean => file.endsWith('.feature.ts'))
      .map((file: string): string => readFileSync(file, 'utf8'))
      .find((text: string): boolean => /^\s*status:\s*[A-Z]\w*,/m.test(text));
    if (descriptor === undefined) {
      continue;
    }
    it(`${feature}_publishesAViewInjector_soItsStatusShows`, () => {
      const registers: boolean = sources.some((file: string): boolean =>
        readFileSync(file, 'utf8').includes('createViewInjectorRegistrar('),
      );

      expect(registers).toBe(true);
    });
  }
});
