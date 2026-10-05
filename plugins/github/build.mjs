// Builds the GitHub plugin into the layout its manifest names.
//
// It has no dependencies — it speaks GitHub's REST API with the runtime's own `fetch`, and asks the
// `gh` program on the machine for its login — so everything is bundled into one `main.js`. It is still
// published as an npm package, because a lockfile-provisioned plugin may contain nothing but
// `node_modules/`: `dist/package` is packed into a tarball, published as a release asset, and named by
// the lockfile like any other dependency (see `scripts/pack-plugin-tarball.mjs`).
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
  // Studio runs plugins under its own runtime (Electron's Node), so this is met by the host.
  target: 'node22',
  format: 'cjs',
  outfile: join(out, 'main.js'),
});

cpSync(join(root, 'package.json'), join(out, 'package.json'));
cpSync(join(root, 'plugin.json'), join(root, 'dist', 'plugin.json'));

console.log('built plugins/github/dist');
