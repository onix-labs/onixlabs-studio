// Puts a plugin's licence, and the notices of everything its bundle carries from others, into the
// package its tarball is packed from (#1612). Called by each plugin's build.mjs after esbuild has run,
// with esbuild's metafile, so the list is what was bundled rather than what package.json declares.
//
// Fails the build as the app's does: on a licence outside licensing/overrides.json's allowlist, or a
// bundled package with no licence text. The outputs carry no timestamps or machine paths, because the
// tarball's integrity is pinned in a lockfile and must rebuild to the same bytes.

import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLicensing, packagesFromMetafile, REPO, report, writeOutputs } from './core.mjs';

/**
 * Writes a plugin's LICENSE, THIRD-PARTY-NOTICES.txt and licences.json beside its bundle.
 * @param {object} options The plugin.
 * @param {string} options.root The plugin's directory, which its build ran in.
 * @param {any} options.metafile The esbuild metafile of its bundle.
 * @param {string} options.out The package directory the tarball is packed from.
 */
export function writePluginLicences({ root, metafile, out }) {
  const licensing = createLicensing();
  const scoped = new Map();
  for (const directory of packagesFromMetafile(metafile, root)) {
    scoped.set(directory, ['plugin']);
  }
  const packages = licensing.collect(scoped);
  const manifest = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  // A first-party plugin is Studio's code, under Studio's licence.
  const studio = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  writeOutputs({
    jsonFile: join(out, 'licences.json'),
    noticesFile: join(out, 'THIRD-PARTY-NOTICES.txt'),
    subject: {
      name: `${manifest.name} plugin for ONIXLabs Studio`,
      version: pkg.version,
      licence: studio.license,
    },
    entries: packages,
  });
  for (const file of ['LICENSE', 'NOTICE']) {
    if (existsSync(join(REPO, file))) {
      copyFileSync(join(REPO, file), join(out, file));
    }
  }
  if (!report(licensing)) {
    throw new Error(`${pkg.name}: its bundle carries a licence Studio cannot ship; see above.`);
  }
}
