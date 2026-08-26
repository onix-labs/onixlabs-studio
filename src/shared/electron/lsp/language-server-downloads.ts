import { ArchiveProvision, everyPlatform } from '../provisioning/archive-provision';

// The pinned, checksum-verified downloads for the language servers Studio installs. Every server is a
// download: nothing is bundled into the application and nothing is expected to be already on the
// machine, so every one of them can be installed and removed like any other plugin.
//
// Each SHA-256 is the one the publisher's own release metadata reports (GitHub computes and publishes a
// digest per release asset; the npm tarballs were downloaded once and hashed). Bumping a version means
// re-pinning its hash — the archive is verified before anything is extracted, so a tampered or
// truncated download is never executed.

/**
 * Holds the pinned Pyright version. Pyright ships as a zero-dependency npm package of bundled
 * JavaScript, so one tarball serves every platform and it runs under the Electron binary in Node mode.
 */
export const PYRIGHT_VERSION: string = '1.1.410';

/**
 * The Pyright provisioning recipe.
 */
export const PYRIGHT_PROVISION: ArchiveProvision = everyPlatform('pyright', PYRIGHT_VERSION, {
  url: `https://registry.npmjs.org/pyright/-/pyright-${PYRIGHT_VERSION}.tgz`,
  sha256: '4d6b7a25f9617ea8ff7b2e98cd87c146d132a95cbfb29bf58bd638018a76ac48',
  archive: 'tar.gz',
  // npm tarballs always extract under a `package/` root.
  executablePath: 'package/langserver.index.js',
});

/**
 * Holds the pinned TypeScript language server version, also a zero-dependency npm package. It finds the
 * TypeScript compiler in the workspace it is serving, so the download carries no compiler of its own.
 */
export const TYPESCRIPT_SERVER_VERSION: string = '4.4.1';

/**
 * The TypeScript language server provisioning recipe.
 */
export const TYPESCRIPT_SERVER_PROVISION: ArchiveProvision = everyPlatform(
  'typescript-language-server',
  TYPESCRIPT_SERVER_VERSION,
  {
    url: `https://registry.npmjs.org/typescript-language-server/-/typescript-language-server-${TYPESCRIPT_SERVER_VERSION}.tgz`,
    sha256: '133fdad406e2cba2fb763b0950914a17bc2aa19d2f4e689ba8a6c706427ed3cf',
    archive: 'tar.gz',
    executablePath: 'package/lib/cli.mjs',
  },
);

/**
 * Holds the pinned clangd version. Upstream publishes one archive per operating system rather than per
 * architecture (the macOS build is universal), so both architectures of a platform share a download.
 */
export const CLANGD_VERSION: string = '22.1.6';

/**
 * Holds the base URL of the pinned clangd release.
 */
const CLANGD_BASE: string = 'https://github.com/clangd/clangd/releases/download/22.1.6';

/**
 * The clangd provisioning recipe. clangd is a large download (~100 MB extracted) because it carries the
 * Clang toolchain's headers, which is precisely why it should be something the user installs when they
 * want C++ support rather than something everyone carries.
 */
export const CLANGD_PROVISION: ArchiveProvision = {
  id: 'clangd',
  version: CLANGD_VERSION,
  downloads: {
    'darwin-arm64': {
      url: `${CLANGD_BASE}/clangd-mac-${CLANGD_VERSION}.zip`,
      sha256: '631aef462556cbd74e0ebaae1778a38d1997d0ba3371652ca54f82652a179e7d',
      archive: 'zip',
      executablePath: `clangd_${CLANGD_VERSION}/bin/clangd`,
    },
    'darwin-x64': {
      url: `${CLANGD_BASE}/clangd-mac-${CLANGD_VERSION}.zip`,
      sha256: '631aef462556cbd74e0ebaae1778a38d1997d0ba3371652ca54f82652a179e7d',
      archive: 'zip',
      executablePath: `clangd_${CLANGD_VERSION}/bin/clangd`,
    },
    'linux-x64': {
      url: `${CLANGD_BASE}/clangd-linux-${CLANGD_VERSION}.zip`,
      sha256: 'a9c77443af2e447ed467e84771848d3a6ac1c56f84bcfcde717e66318de77cfa',
      archive: 'zip',
      executablePath: `clangd_${CLANGD_VERSION}/bin/clangd`,
    },
    'win32-x64': {
      url: `${CLANGD_BASE}/clangd-windows-${CLANGD_VERSION}.zip`,
      sha256: 'ce54f16e0b4fd76d450eeda9664420b195360b73febcfe40e661108fa57f2ce1',
      archive: 'zip',
      executablePath: `clangd_${CLANGD_VERSION}/bin/clangd.exe`,
    },
  },
};

/**
 * Holds the pinned version of `ty`, Astral's Python language server — the alternative to Pyright, and
 * the reason the Python slot is a choice rather than a default.
 */
export const TY_VERSION: string = '0.0.74';

/**
 * Holds the base URL of the pinned `ty` release.
 */
const TY_BASE: string = 'https://github.com/astral-sh/ty/releases/download/0.0.74';

/**
 * The `ty` provisioning recipe: a per-triple standalone binary.
 */
export const TY_PROVISION: ArchiveProvision = {
  id: 'ty',
  version: TY_VERSION,
  downloads: {
    'darwin-arm64': {
      url: `${TY_BASE}/ty-aarch64-apple-darwin.tar.gz`,
      sha256: '79b08069f29833383650515a31f260a60a81224b31fdb9fa21a56c1ead032a6e',
      archive: 'tar.gz',
      executablePath: 'ty-aarch64-apple-darwin/ty',
    },
    'darwin-x64': {
      url: `${TY_BASE}/ty-x86_64-apple-darwin.tar.gz`,
      sha256: '5f49f82e8f057de44a8e747fe0afa5573a3d324ce1c4e29bb9d97e6decbe7570',
      archive: 'tar.gz',
      executablePath: 'ty-x86_64-apple-darwin/ty',
    },
    'linux-x64': {
      url: `${TY_BASE}/ty-x86_64-unknown-linux-gnu.tar.gz`,
      sha256: 'abe58455698503f180e0aaabdda54a8d0a084c4dec2e45effd902e414651f4bc',
      archive: 'tar.gz',
      executablePath: 'ty-x86_64-unknown-linux-gnu/ty',
    },
    'linux-arm64': {
      url: `${TY_BASE}/ty-aarch64-unknown-linux-gnu.tar.gz`,
      sha256: 'c84046657424e03f890650c188988bd1552788cfbd88e4b536fc82099bcb7e61',
      archive: 'tar.gz',
      executablePath: 'ty-aarch64-unknown-linux-gnu/ty',
    },
    'win32-x64': {
      url: `${TY_BASE}/ty-x86_64-pc-windows-msvc.zip`,
      sha256: '45dbce4b3fa2f65e4672d3756c12448a9ec9a69732655dc4429c70af1fe02d37',
      archive: 'zip',
      executablePath: 'ty-x86_64-pc-windows-msvc/ty.exe',
    },
  },
};
