// Builds the Codex agent harness into the layout its manifest names.
//
// The harness drives the `codex` CLI, shipped by `@openai/codex` as a per-platform native binary that
// the harness resolves relative to that package at run time, so the package has to be installed beside
// the bundle rather than inlined into it. The manifest therefore provisions an npm dependency tree
// rather than a single archived file, which is the shape `provision.kind: 'npm'` exists for — and the
// `os`/`cpu` filter in that tree is what fetches one platform's binary rather than every platform's.
//
// That decides this file's output. A lockfile-provisioned tree may contain nothing but `node_modules/`
// (`isConfined` in `lockfile-provision.ts` refuses any other destination), so the harness cannot be a
// loose file beside the tree — it has to BE one of the packages in it. What is built here is therefore
// an npm package: `dist/package` is packed into a tarball, published as a release asset, and named by
// the lockfile like any other dependency.
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
  // Pinned so the output does not depend on where this was run from. esbuild writes each module's path
  // into the bundle as a comment, relative to the working directory — so building from the repository
  // root and building from this directory produce different bytes for identical sources. That matters
  // more here than it looks: the tarball's integrity is pinned in a lockfile, so a bundle that differs
  // by nothing but a comment is an install that fails verification on every user's machine.
  absWorkingDir: root,
  // Studio runs this under its own runtime — Electron 42's Node 24. Nothing from `@openai/codex` is
  // imported: the harness only resolves the package's location to find the binary, so there is nothing
  // to leave external.
  target: 'node22',
  format: 'cjs',
  outfile: join(out, 'main.js'),
});

// The package manifest ships inside the tarball: it is what names the CLI dependency that the lockfile
// then resolves, and what puts `main.js` at the path the plugin manifest's entry point points to.
cpSync(join(root, 'package.json'), join(out, 'package.json'));
cpSync(join(root, 'plugin.json'), join(root, 'dist', 'plugin.json'));

console.log('built plugins/codex-harness/dist');
