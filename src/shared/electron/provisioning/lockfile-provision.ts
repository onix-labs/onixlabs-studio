// Reading an npm lockfile as a provisioning recipe.
//
// A lockfile is already the document this provisioner wants: a flat list whose key is a destination
// path and whose value carries a tarball URL and an integrity hash. Nothing here resolves a version
// range, contacts a registry for metadata, or reads a `package.json` — the tree was decided when the
// lockfile was generated, and this module's only job is to say what that tree is, strictly enough that
// an untrusted document cannot describe something dangerous.

/**
 * Describes a plugin obtained by installing an npm dependency tree.
 */
export interface LockfileProvision {
  /**
   * Gets the plugin identifier, which is also its install directory.
   */
  readonly id: string;

  /**
   * Gets the version, so installs are version-scoped and an upgrade cannot half-overwrite a tree.
   */
  readonly version: string;

  /**
   * Gets the URL of the lockfile naming the tree.
   */
  readonly lockfileUrl: string;

  /**
   * Gets the expected lower-case hex SHA-256 of the lockfile itself.
   */
  readonly sha256: string;

  /**
   * Gets the entry point's path within the installed tree, or undefined when the payload holds several
   * programs and each contribution names its own (#454).
   */
  readonly executablePath?: string;
}

/**
 * One package to install: where it goes, where it comes from, and what it must hash to.
 */
export interface LockfilePackage {
  /**
   * Gets the destination path relative to the install root, such as `node_modules/left-pad`.
   */
  readonly path: string;

  /**
   * Gets the tarball URL.
   */
  readonly url: string;

  /**
   * Gets the Subresource Integrity string, `<algorithm>-<base64>`.
   */
  readonly integrity: string;

  /**
   * Gets the integrity algorithm, split from {@link integrity} once so the verifier does not re-parse.
   */
  readonly algorithm: string;
}

/**
 * The lockfile versions this understands. Both record the flat `packages` map this reads; v1 does not
 * and is refused rather than half-read.
 */
const SUPPORTED_LOCKFILE_VERSIONS: readonly number[] = [2, 3];

/**
 * The integrity algorithms accepted. A pin is only as good as its hash, and SHA-1 — which very old
 * registry entries still carry — has been collision-broken for years, so it is refused rather than
 * quietly treated as a guarantee. Everything in the current target set is SHA-512.
 */
const SUPPORTED_ALGORITHMS: readonly string[] = ['sha512', 'sha256'];

/**
 * Determines whether a platform constraint list admits a value, using npm's own semantics: bare
 * entries are an allow-list, `!`-prefixed entries are a deny-list, and a list of only denials admits
 * everything it does not name.
 * @param list The `os` or `cpu` list, or undefined when the package is unconstrained.
 * @param value The running platform or architecture.
 * @returns Returns true when the package may be installed here.
 */
function admits(list: unknown, value: string): boolean {
  if (!Array.isArray(list) || list.length === 0) {
    return true;
  }
  let allowed: boolean = false;
  let hasAllowList: boolean = false;
  for (const item of list) {
    if (typeof item !== 'string') {
      continue;
    }
    if (item.startsWith('!')) {
      if (item.slice(1) === value) {
        return false;
      }
      continue;
    }
    hasAllowList = true;
    allowed = allowed || item === value;
  }
  return hasAllowList ? allowed : true;
}

/**
 * Determines whether a destination path is one this may write to.
 *
 * The lockfile's key becomes a filesystem path under the install root, so this is the boundary that
 * stops a hostile or corrupt document from naming `../../../.ssh/authorized_keys`. Everything a tree
 * contains lives under `node_modules/`; anything else is refused rather than sanitised, because a path
 * that needed rewriting to be safe is a document that should not be trusted at all.
 * @param value The candidate destination path.
 * @returns Returns true when the path is confined to the tree.
 */
function isConfined(value: string): boolean {
  return (
    value.startsWith('node_modules/') &&
    !value.includes('..') &&
    !value.startsWith('/') &&
    !/^[a-zA-Z]:/.test(value) &&
    !value.includes('\\')
  );
}

/**
 * Reads a verified lockfile into the list of packages to install.
 *
 * Returns null when the document is not a lockfile this can honour. Individual entries that name no
 * tarball are skipped rather than fatal — a workspace link or the root project has no tarball by
 * definition — but an entry that is *malformed*, rather than absent, fails the whole document: a
 * partially understood tree is the outcome this design exists to avoid.
 * @param text The lockfile's contents, already verified against its pinned hash.
 * @param platform The running platform, defaulting to this process's.
 * @param architecture The running architecture, defaulting to this process's.
 * @returns Returns the packages to install, or null when the document cannot be honoured.
 */
export function parseLockfile(
  text: string,
  platform: string = process.platform,
  architecture: string = process.arch,
): readonly LockfilePackage[] | null {
  try {
    return parseLockfileDocument(JSON.parse(text), platform, architecture);
  } catch {
    return null;
  }
}

/**
 * Reads an already-parsed lockfile into the list of packages to install.
 *
 * Separate from {@link parseLockfile} because a lockfile compiled into the application arrives as a
 * value rather than as bytes, and round-tripping it through JSON only to parse it again would invent a
 * difference between the two that does not exist.
 * @param document The lockfile document.
 * @param platform The running platform, defaulting to this process's.
 * @param architecture The running architecture, defaulting to this process's.
 * @returns Returns the packages to install, or null when the document cannot be honoured.
 */
export function parseLockfileDocument(
  document: unknown,
  platform: string = process.platform,
  architecture: string = process.arch,
): readonly LockfilePackage[] | null {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return null;
  }
  const source: Record<string, unknown> = document as Record<string, unknown>;
  if (!SUPPORTED_LOCKFILE_VERSIONS.includes(source['lockfileVersion'] as number)) {
    return null;
  }
  const packages: unknown = source['packages'];
  if (typeof packages !== 'object' || packages === null || Array.isArray(packages)) {
    return null;
  }

  const result: LockfilePackage[] = [];
  for (const [key, value] of Object.entries(packages as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }
    const entry: Record<string, unknown> = value as Record<string, unknown>;
    // The root project, a workspace link, and anything scoped to development are not part of what a
    // user installs. None of them names a tarball, so none of them is a failure.
    if (key === '' || entry['link'] === true || entry['dev'] === true) {
      continue;
    }
    if (entry['resolved'] === undefined && entry['integrity'] === undefined) {
      continue;
    }
    // A package this machine is not meant to have — the wrong platform's prebuilt binary — is skipped,
    // which is what makes one lockfile describe the tree everywhere.
    if (!admits(entry['os'], platform) || !admits(entry['cpu'], architecture)) {
      continue;
    }
    const url: unknown = entry['resolved'];
    const integrity: unknown = entry['integrity'];
    if (typeof url !== 'string' || typeof integrity !== 'string') {
      return null;
    }
    if (!url.startsWith('https://')) {
      return null;
    }
    if (!isConfined(key)) {
      return null;
    }
    const algorithm: string = integrity.split('-')[0] ?? '';
    if (!SUPPORTED_ALGORITHMS.includes(algorithm)) {
      return null;
    }
    result.push({ path: key, url, integrity, algorithm });
  }
  return result;
}
