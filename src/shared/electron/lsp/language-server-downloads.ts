import { ArchiveProvision, everyPlatform } from '../provisioning/archive-provision';

// The pinned, checksum-verified downloads for the two language servers whose recipes still have to be
// referenced from code, because their descriptors honour a path the user can set in Settings and so
// need to name the recipe they fall back to.
//
// Every other server's recipe is in the curated index (`curated-plugins.json`) as data. This file used
// to be that index, written in TypeScript.
//
// Each SHA-256 is the one the publisher's own release metadata reports (GitHub computes and publishes a
// digest per release asset; the npm tarballs were downloaded once and hashed). Bumping a version means
// re-pinning its hash — the archive is verified before anything is extracted, so a tampered or
// truncated download is never executed.

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
