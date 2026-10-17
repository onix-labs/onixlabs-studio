// Builds the Podman engine plugin into the layout its manifest names (#973).
//
// Podman serves the Docker Engine API, so this plugin is the Docker plugin's source built under its own
// name and manifest — the manifest is what says where Podman's socket is. Everything is bundled into
// one `main.js`, published as an npm package (see `scripts/pack-plugin-tarball.mjs`).
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, 'dist', 'package');

rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, '..', 'docker-engine', 'src', 'main.ts')],
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

console.log('built plugins/podman-engine/dist');
