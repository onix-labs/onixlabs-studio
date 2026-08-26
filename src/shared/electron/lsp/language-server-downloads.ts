import {
  ArchiveDownload,
  ArchiveProvision,
  everyPlatform,
} from '../provisioning/archive-provision';

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

/**
 * Holds the pinned lua-language-server version. Publishes an archive per platform and architecture, so
 * every platform Studio supports is covered.
 */
export const LUA_VERSION: string = '3.19.1';

/**
 * Holds the base URL of the pinned lua-language-server release.
 */
const LUA_BASE: string = 'https://github.com/LuaLS/lua-language-server/releases/download/3.19.1';

/**
 * Builds one lua-language-server download. The archive extracts to its own root rather than a
 * versioned directory, so the entry point is simply `bin/`.
 * @param asset The asset file name.
 * @param sha256 The asset's SHA-256.
 * @param windows Whether this is the Windows build, which is a zip with a `.exe`.
 * @returns Returns the download.
 */
function luaDownload(asset: string, sha256: string, windows: boolean = false): ArchiveDownload {
  return {
    url: `${LUA_BASE}/${asset}`,
    sha256,
    archive: windows ? 'zip' : 'tar.gz',
    executablePath: windows ? 'bin/lua-language-server.exe' : 'bin/lua-language-server',
  };
}

/**
 * The lua-language-server provisioning recipe.
 */
export const LUA_PROVISION: ArchiveProvision = {
  id: 'lua-language-server',
  version: LUA_VERSION,
  downloads: {
    'darwin-arm64': luaDownload(
      `lua-language-server-${LUA_VERSION}-darwin-arm64.tar.gz`,
      '0bc077f4447f076b4c92c14e9fd303f5b569eda2ec74b4dca2b55f75fae2e90c',
    ),
    'darwin-x64': luaDownload(
      `lua-language-server-${LUA_VERSION}-darwin-x64.tar.gz`,
      'eb373c159cbe556711d7cd316315de2dce969bfd54b31edb7eb9cab2937f2cca',
    ),
    'linux-x64': luaDownload(
      `lua-language-server-${LUA_VERSION}-linux-x64.tar.gz`,
      'e9235d2d72ef55bc41cf8c99cda2ed64777682024b4bb81f5dea425060c5cbb8',
    ),
    'linux-arm64': luaDownload(
      `lua-language-server-${LUA_VERSION}-linux-arm64.tar.gz`,
      'abd2572e8fc929dc838a81ffb8473c5bce0bf39bfe8edb4b120b3b623176ce83',
    ),
    'win32-x64': luaDownload(
      `lua-language-server-${LUA_VERSION}-win32-x64.zip`,
      'fdb9a59108cf62517813c97fa5549b0e16d1ef0688306bac728b08434db7e4cd',
      true,
    ),
  },
};

/**
 * Holds the pinned sqls version. Upstream publishes x86-64 builds only, so Apple Silicon and 64-bit
 * ARM Linux have no entry and the Plugin Manager reports it unsupported there rather than offering an
 * install that could only fail.
 */
export const SQLS_VERSION: string = '0.2.48';

/**
 * Holds the base URL of the pinned sqls release.
 */
const SQLS_BASE: string = 'https://github.com/sqls-server/sqls/releases/download/v0.2.48';

/**
 * The sqls provisioning recipe. Each archive holds the bare executable at its root.
 */
export const SQLS_PROVISION: ArchiveProvision = {
  id: 'sqls',
  version: SQLS_VERSION,
  downloads: {
    'darwin-x64': {
      url: `${SQLS_BASE}/sqls-darwin-${SQLS_VERSION}.zip`,
      sha256: 'b44165ca597a4b4298d56657bc911aa3ca8a591befefde4e29566923c6229f3d',
      archive: 'zip',
      executablePath: 'sqls',
    },
    'linux-x64': {
      url: `${SQLS_BASE}/sqls-linux-${SQLS_VERSION}.zip`,
      sha256: '30047b92c41658c821b7803d2c2a3a1ce4e17ee769ceff6f24bb9e3daaf5d4dc',
      archive: 'zip',
      executablePath: 'sqls',
    },
    'win32-x64': {
      url: `${SQLS_BASE}/sqls-windows-${SQLS_VERSION}.zip`,
      sha256: 'df6453b2ddcb4e748547d0288b826251a24af099749dc7a9ddea587aac3d4365',
      archive: 'zip',
      executablePath: 'sqls.exe',
    },
  },
};

/**
 * Holds the pinned Perl Navigator version. Also x86-64 only.
 */
export const PERLNAVIGATOR_VERSION: string = '0.8.20';

/**
 * Holds the base URL of the pinned Perl Navigator release.
 */
const PERLNAVIGATOR_BASE: string =
  'https://github.com/bscan/perlnavigator/releases/download/v0.8.20';

/**
 * The Perl Navigator provisioning recipe. Each archive extracts to a directory named after the asset,
 * so the entry point carries that prefix.
 */
export const PERLNAVIGATOR_PROVISION: ArchiveProvision = {
  id: 'perlnavigator',
  version: PERLNAVIGATOR_VERSION,
  downloads: {
    'darwin-x64': {
      url: `${PERLNAVIGATOR_BASE}/perlnavigator-macos-x86_64.zip`,
      sha256: '064700f91923b076fe77542311b22465be9fb1acd72102d5b558d5e4d90d46a9',
      archive: 'zip',
      executablePath: 'perlnavigator-macos-x86_64/perlnavigator',
    },
    'linux-x64': {
      url: `${PERLNAVIGATOR_BASE}/perlnavigator-linux-x86_64.zip`,
      sha256: '5a29c8a6919c32c6b47f05ab1ed38f62fffa56ec1752b8e9d6245e177ba32cd2',
      archive: 'zip',
      executablePath: 'perlnavigator-linux-x86_64/perlnavigator',
    },
    'win32-x64': {
      url: `${PERLNAVIGATOR_BASE}/perlnavigator-win-x86_64.zip`,
      sha256: '3a521c936b01046ed79cc6f3e3ac31a71c5368641aeeb28fea11b21577380ee2',
      archive: 'zip',
      executablePath: 'perlnavigator-win-x86_64/perlnavigator.exe',
    },
  },
};
