// Builds the Claude agent harness into the layout its manifest names.
//
// The SDK is left EXTERNAL rather than bundled. It ships its own Claude Code CLI as a per-platform
// binary asset and resolves it relative to its own module path, so inlining the JavaScript would
// produce a bundle that cannot find the program it exists to drive. The manifest therefore provisions
// an npm dependency tree rather than a single archived file, which is the shape `provision.kind: 'npm'`
// exists for — and the `os`/`cpu` filter in that tree is what fetches one platform's 196MB binary
// instead of all eight.
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
  // Node 22 is the floor, not a preference: the SDK is ESM-only ("type": "module", and its sole export
  // condition is `sdk.mjs`), so a CommonJS bundle reaches it through `require(esm)`, which is unflagged
  // from 22.12. Studio runs this under its own runtime — Electron 42's Node 24 — so the floor is met by
  // the host rather than by whatever the user has installed.
  target: 'node22',
  format: 'cjs',
  outfile: join(out, 'main.js'),
  external: ['@anthropic-ai/claude-agent-sdk'],
});

// The package manifest ships inside the tarball: it is what names the SDK dependency that the lockfile
// then resolves, and what puts `main.js` at the path the plugin manifest's entry point points to.
cpSync(join(root, 'package.json'), join(out, 'package.json'));
cpSync(join(root, 'plugin.json'), join(root, 'dist', 'plugin.json'));

console.log('built plugins/claude-harness/dist');
