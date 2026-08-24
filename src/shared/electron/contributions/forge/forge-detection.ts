// Resolves a git remote URL to the repository it names on a forge. Pure string work, kept free of
// Electron and Node imports so it is unit-testable on its own.

import { ForgeKind, ForgeRepositoryRef } from '@shared/api/forge-types';

/**
 * The hosts recognised as a forge, mapped to the implementation that serves them. Self-hosted
 * instances are deliberately absent: a host cannot be assumed to be GitHub Enterprise merely because
 * it is unfamiliar, so recognising one will mean the user naming it rather than Studio guessing.
 */
const FORGE_HOSTS: Readonly<Record<string, ForgeKind>> = {
  'github.com': 'github',
  'www.github.com': 'github',
};

/**
 * Matches the SCP-like syntax git accepts for SSH remotes (`git@github.com:owner/repo.git`), which is
 * not a URL and so cannot be parsed as one.
 */
const SCP_LIKE: RegExp = /^(?:([^@/]+)@)?([^:/]+):(.+)$/;

/**
 * Resolves a git remote URL to the repository it names on a forge.
 *
 * Accepts every form git writes a remote in: `https://github.com/owner/repo.git`, the SCP-like
 * `git@github.com:owner/repo.git`, an explicit `ssh://git@github.com/owner/repo.git`, and the same
 * without the `.git` suffix. A URL naming an unrecognised host, or one that carries no owner and
 * repository, resolves to null — the panel then says the repository has no forge rather than showing
 * sections that could never populate.
 *
 * @param remoteUrl The remote's URL, in any form git writes it.
 * @returns Returns the repository reference, or null when the URL names no forge Studio can talk to.
 */
export function detectForge(remoteUrl: string): ForgeRepositoryRef | null {
  const trimmed: string = remoteUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parts: { host: string; path: string } | null = splitRemote(trimmed);
  if (parts === null) {
    return null;
  }
  const kind: ForgeKind | undefined = FORGE_HOSTS[parts.host.toLowerCase()];
  if (kind === undefined) {
    return null;
  }
  const segments: readonly string[] = parts.path
    .split('/')
    .filter((segment: string): boolean => segment.length > 0);
  // Exactly owner and repository. A longer path is a gist, a subgroup, or something else this does not
  // model, and guessing which two segments were meant would be worse than declining.
  if (segments.length !== 2) {
    return null;
  }
  const name: string = segments[1].replace(/\.git$/i, '');
  if (segments[0].length === 0 || name.length === 0) {
    return null;
  }
  return { kind, host: parts.host.toLowerCase(), owner: segments[0], name };
}

/**
 * Splits a remote URL into its host and path, handling both real URLs and git's SCP-like SSH syntax.
 * @param remoteUrl The trimmed remote URL.
 * @returns Returns the host and path, or null when neither form parses.
 */
function splitRemote(remoteUrl: string): { host: string; path: string } | null {
  if (remoteUrl.includes('://')) {
    try {
      const url: URL = new URL(remoteUrl);
      return { host: url.hostname, path: url.pathname };
    } catch {
      return null;
    }
  }
  const match: RegExpMatchArray | null = SCP_LIKE.exec(remoteUrl);
  if (match === null) {
    return null;
  }
  // A Windows path (`C:\repos\thing`) matches the SCP-like shape; its "host" is a drive letter, which
  // no forge host list will contain, so it falls out at the host lookup rather than needing a case here.
  return { host: match[2], path: match[3] };
}
