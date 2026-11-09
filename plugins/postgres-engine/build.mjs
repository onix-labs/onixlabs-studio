// Builds the PostgreSQL engine plugin into the layout its manifest names (#1096).
//
// Its one dependency, `pg`, the pure-JavaScript PostgreSQL client, is bundled with the engine and the shared host into one
// `main.js`, published as an npm package because a lockfile-provisioned plugin may contain nothing but
// `node_modules/` (see `scripts/pack-plugin-tarball.mjs`). Bundling keeps the pinned tree to a single
// tarball, as the AI SDK harness does with its SDK.
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
  // `pg` reaches for two optional modules it does not need here: `pg-native`, the libpq binding it
  // uses only when asked, and Cloudflare's socket API, which exists only in Workers.
  external: ['pg-native', 'cloudflare:sockets'],
  outfile: join(out, 'main.js'),
});

cpSync(join(root, 'package.json'), join(out, 'package.json'));
cpSync(join(root, 'plugin.json'), join(root, 'dist', 'plugin.json'));

console.log('built plugins/postgres-engine/dist');
