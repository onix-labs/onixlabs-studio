// Builds the SQLite engine plugin into the layout its manifest names (#1095).
//
// It has no dependencies — SQLite is the runtime's own `node:sqlite` — so everything is bundled into one
// `main.js`, published as an npm package because a lockfile-provisioned plugin may contain nothing but
// `node_modules/` (see `scripts/pack-plugin-tarball.mjs`). The same `main.js` is also each session's
// query-runner process.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, 'dist', 'package');

rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, 'src', 'main.ts')],
  bundle: true,
  platform: 'node',
  // Pinned so the bytes do not depend on where this was run from: esbuild writes module paths into the
  // bundle relative to the working directory, and the tarball's integrity is pinned in a lockfile.
  absWorkingDir: root,
  // Studio runs plugins under its own runtime (Electron's Node, 24.x), which has `node:sqlite`.
  target: 'node22',
  format: 'cjs',
  outfile: join(out, 'main.js'),
});

cpSync(join(root, 'package.json'), join(out, 'package.json'));
cpSync(join(root, 'plugin.json'), join(root, 'dist', 'plugin.json'));

console.log('built plugins/sqlite-engine/dist');
