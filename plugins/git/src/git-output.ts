import {
  VcsBranch,
  VcsChangeStatus,
  VcsCommit,
  VcsFileChange,
  VcsRef,
  VcsRefs,
  VcsRemote,
  VcsRemoteBranch,
  VcsStash,
  VcsStatus,
  VcsTag,
} from './protocol';

// Parsers for git's machine-readable output, turning it into the version-control protocol's types
// (#816). They lived in the renderer while the main process returned raw output; behind the protocol,
// parsing is the plugin's job, so nothing on Studio's side of the seam reads porcelain.

/**
 * The ASCII unit separator, used between fields of the custom `log`, `for-each-ref` and stash formats.
 */
export const US: string = '\x1f';

/**
 * The ASCII record separator, used between records of the custom `log` format.
 */
export const RS: string = '\x1e';

/**
 * The NUL character that delimits `-z` output.
 */
const NUL: string = '\0';

/**
 * Maps a porcelain status letter to a change status.
 * @param letter The git status letter (M, A, D, R, C, …).
 * @returns Returns the mapped change status.
 */
function mapStatus(letter: string): VcsChangeStatus {
  switch (letter) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
    case 'C':
      return 'renamed';
    default:
      return 'modified';
  }
}

/**
 * Builds a working-tree file change, with line tallies of zero (porcelain status does not carry them).
 * @param path The file path.
 * @param status The change status.
 * @param previousPath The pre-rename path, when renamed.
 * @param untracked Whether the file is untracked (a `?` entry).
 * @returns Returns the file change.
 */
function change(
  path: string,
  status: VcsChangeStatus,
  previousPath?: string,
  untracked?: boolean,
): VcsFileChange {
  return {
    path,
    status,
    additions: 0,
    deletions: 0,
    ...(previousPath === undefined ? {} : { previousPath }),
    ...(untracked === true ? { untracked } : {}),
  };
}

/**
 * Parses `git status --porcelain=v2 --branch -z` output into the branch header and the staged,
 * unstaged and conflicted changes. The NUL-delimited stream interleaves header lines, ordinary and
 * rename entries (whose rename form carries a second, separately-delimited path), unmerged entries and
 * untracked entries.
 * @param output The raw command output.
 * @returns Returns the status.
 */
export function parseStatus(output: string): VcsStatus {
  const tokens: string[] = output.split(NUL).filter((token: string): boolean => token.length > 0);
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead: number = 0;
  let behind: number = 0;
  const staged: VcsFileChange[] = [];
  const unstaged: VcsFileChange[] = [];
  const conflicted: VcsFileChange[] = [];

  for (let index: number = 0; index < tokens.length; index++) {
    const token: string = tokens[index];

    if (token.startsWith('# ')) {
      const [, key, ...rest]: string[] = token.split(' ');
      const value: string = rest.join(' ');
      if (key === 'branch.head') {
        branch = value === '(detached)' ? null : value;
      } else if (key === 'branch.upstream') {
        upstream = value;
      } else if (key === 'branch.ab') {
        // Form: "+<ahead> -<behind>".
        const [aheadPart, behindPart]: string[] = value.split(' ');
        ahead = Math.abs(Number.parseInt(aheadPart, 10)) || 0;
        behind = Math.abs(Number.parseInt(behindPart, 10)) || 0;
      }
      continue;
    }

    if (token.startsWith('1 ') || token.startsWith('2 ')) {
      const rename: boolean = token.startsWith('2 ');
      const parts: string[] = token.split(' ');
      const xy: string = parts[1];
      // Ordinary entries carry 8 metadata fields before the path; rename entries carry 9 (the extra
      // is the similarity score).
      const path: string = parts.slice(rename ? 9 : 8).join(' ');
      let previousPath: string | undefined;
      if (rename) {
        // The pre-rename path follows as its own NUL-delimited token.
        previousPath = tokens[index + 1];
        index += 1;
      }
      if (!xy.startsWith('.')) {
        staged.push(change(path, mapStatus(xy[0]), previousPath));
      }
      if (xy[1] !== '.') {
        unstaged.push(change(path, mapStatus(xy[1]), previousPath));
      }
      continue;
    }

    if (token.startsWith('u ')) {
      // Unmerged entries carry 10 metadata fields before the path. Git reports a conflicted path as
      // one of these INSTEAD of an ordinary or rename entry, so nothing here is also staged or unstaged.
      conflicted.push(change(token.split(' ').slice(10).join(' '), 'conflicted'));
      continue;
    }

    if (token.startsWith('? ')) {
      unstaged.push(change(token.slice(2), 'added', undefined, true));
    }
    // '! ' (ignored) entries are skipped: the panel shows what git is tracking, not what it is not.
  }

  return { branch, upstream, ahead, behind, staged, unstaged, conflicted };
}

/**
 * Parses a `%D` ref-decoration string (for example `HEAD -> main, origin/main, tag: v1.0`) into refs.
 * @param decoration The decoration string.
 * @returns Returns the refs.
 */
function parseDecorations(decoration: string): VcsRef[] {
  const refs: VcsRef[] = [];
  for (const raw of decoration.trim().split(', ')) {
    const part: string = raw.trim();
    if (part.length === 0) {
      continue;
    }
    if (part.startsWith('tag: ')) {
      refs.push({ name: part.slice('tag: '.length), kind: 'tag' });
    } else if (part.startsWith('HEAD -> ')) {
      refs.push({ name: 'HEAD', kind: 'head' });
      refs.push({ name: part.slice('HEAD -> '.length), kind: 'branch' });
    } else if (part === 'HEAD') {
      refs.push({ name: 'HEAD', kind: 'head' });
    } else if (part.includes('/')) {
      refs.push({ name: part, kind: 'remote' });
    } else {
      refs.push({ name: part, kind: 'branch' });
    }
  }
  return refs;
}

/**
 * The `git log` format {@link parseLog} reads: hash, short hash, parents, author, email, ISO date,
 * decorations, subject and body, unit-separated, each record ended by a record separator.
 */
export const LOG_FORMAT: string = '%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%D%x1f%s%x1f%b%x1e';

/**
 * Parses `git log` output in {@link LOG_FORMAT} into commits.
 * @param output The raw command output.
 * @returns Returns the commits, newest first.
 */
export function parseLog(output: string): VcsCommit[] {
  return output
    .split(RS)
    .map((record: string): string => record.replace(/^\r?\n/, ''))
    .filter((record: string): boolean => record.trim().length > 0)
    .map((record: string): VcsCommit => {
      const f: string[] = record.split(US);
      const parents: string[] = (f[2] ?? '').trim().length > 0 ? f[2].trim().split(' ') : [];
      return {
        hash: f[0] ?? '',
        shortHash: f[1] ?? '',
        parents,
        author: f[3] ?? '',
        email: f[4] ?? '',
        isoDate: f[5] ?? '',
        refs: parseDecorations(f[6] ?? ''),
        summary: f[7] ?? '',
        body: (f[8] ?? '').trim(),
      };
    });
}

/**
 * Parses the ahead/behind counts from an `upstream:track` string (for example `[ahead 1, behind 2]`).
 * @param track The track string.
 * @returns Returns the ahead and behind counts.
 */
function parseTrack(track: string): { ahead: number; behind: number } {
  const ahead: RegExpMatchArray | null = /ahead (\d+)/.exec(track);
  const behind: RegExpMatchArray | null = /behind (\d+)/.exec(track);
  return {
    ahead: ahead !== null ? Number.parseInt(ahead[1], 10) : 0,
    behind: behind !== null ? Number.parseInt(behind[1], 10) : 0,
  };
}

/**
 * The `git for-each-ref` format {@link parseRefs} reads.
 */
export const REFS_FORMAT: string =
  '%(refname)%1f%(objectname)%1f%(HEAD)%1f%(upstream:short)%1f%(upstream:track)';

/**
 * Parses `git for-each-ref` output in {@link REFS_FORMAT} into local branches, remotes and tags. The
 * remotes carry no URL yet; {@link mergeRemoteUrls} fills it from `git remote -v`.
 * @param output The raw command output.
 * @returns Returns the refs.
 */
export function parseRefs(output: string): VcsRefs {
  const branches: VcsBranch[] = [];
  const tags: VcsTag[] = [];
  const remoteBranches: Map<string, VcsRemoteBranch[]> = new Map<string, VcsRemoteBranch[]>();

  for (const line of output.split('\n')) {
    if (line.trim().length === 0) {
      continue;
    }
    const [refName, objectName, head, upstreamShort, track]: string[] = line.split(US);
    if (refName.startsWith('refs/heads/')) {
      const counts: { ahead: number; behind: number } = parseTrack(track ?? '');
      branches.push({
        name: refName.slice('refs/heads/'.length),
        current: head === '*',
        ...(upstreamShort !== undefined && upstreamShort.length > 0
          ? { upstream: upstreamShort }
          : {}),
        ahead: counts.ahead,
        behind: counts.behind,
        tip: objectName,
      });
    } else if (refName.startsWith('refs/remotes/')) {
      const short: string = refName.slice('refs/remotes/'.length);
      const remoteName: string = short.split('/')[0];
      const list: VcsRemoteBranch[] = remoteBranches.get(remoteName) ?? [];
      // The tip is kept, not dropped: a row that cannot name a commit cannot navigate to one.
      list.push({ name: short, commit: objectName });
      remoteBranches.set(remoteName, list);
    } else if (refName.startsWith('refs/tags/')) {
      tags.push({ name: refName.slice('refs/tags/'.length), commit: objectName });
    }
  }

  const remotes: VcsRemote[] = [...remoteBranches.entries()].map(
    ([name, list]: [string, VcsRemoteBranch[]]): VcsRemote => ({ name, url: '', branches: list }),
  );
  return { branches, remotes, tags };
}

/**
 * Parses `git remote -v` output into a remote-name-to-URL map.
 *
 * Each remote appears twice, once for fetch and once for push, and the two can differ (a fork's push
 * URL against an upstream's fetch URL). The fetch URL wins: it names the repository the branches and
 * pull requests being read actually come from, which is what forge detection needs.
 * @param output The raw command output.
 * @returns Returns the URL by remote name.
 */
export function parseRemoteUrls(output: string): ReadonlyMap<string, string> {
  const urls: Map<string, string> = new Map<string, string>();
  for (const line of output.split('\n')) {
    const match: RegExpMatchArray | null = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim());
    if (match === null) {
      continue;
    }
    const [, name, url, direction]: string[] = match;
    if (direction === 'fetch' || !urls.has(name)) {
      urls.set(name, url);
    }
  }
  return urls;
}

/**
 * Fills in each remote's URL, and adds any configured remote that has no remote-tracking branches yet.
 *
 * A freshly-cloned or newly-added remote has no `refs/remotes/*` entries until something is fetched, so
 * refs alone would omit it entirely — leaving a repository with a perfectly good remote looking like it
 * had none.
 * @param remotes The remotes parsed from refs.
 * @param urls The URL by remote name.
 * @returns Returns the merged remotes, in configuration order with ref-only remotes appended.
 */
export function mergeRemoteUrls(
  remotes: readonly VcsRemote[],
  urls: ReadonlyMap<string, string>,
): readonly VcsRemote[] {
  const byName: Map<string, VcsRemote> = new Map<string, VcsRemote>(
    remotes.map((remote: VcsRemote): [string, VcsRemote] => [remote.name, remote]),
  );
  const merged: VcsRemote[] = [];
  for (const [name, url] of urls) {
    merged.push({ name, url, branches: byName.get(name)?.branches ?? [] });
    byName.delete(name);
  }
  // Anything left had tracking branches but no configured URL — a stale `refs/remotes` entry for a
  // removed remote. Kept rather than dropped: its branches are still checkoutable refs.
  merged.push(...byName.values());
  return merged;
}

/**
 * The `git stash list` format {@link parseStashes} reads.
 *
 * ⚠️ `%x1f`, not `%1f`: `stash list` takes `log`'s format codes, where a byte is written in hex after
 * `%x`. `%1f` is `for-each-ref`'s spelling, and here it printed literally — so until #816 every stash
 * showed no message and no branch.
 */
export const STASH_FORMAT: string = '%gd%x1f%H%x1f%s';

/**
 * Parses `git stash list` output in {@link STASH_FORMAT} into stash entries. Their files are not
 * listed by this command and start empty.
 * @param output The raw command output.
 * @returns Returns the stashes, newest first.
 */
export function parseStashes(output: string): VcsStash[] {
  return output
    .split('\n')
    .filter((line: string): boolean => line.trim().length > 0)
    .map((line: string, position: number): VcsStash => {
      const [selector, , message]: string[] = line.split(US);
      const branchMatch: RegExpMatchArray | null = /\bon ([^:]+):/i.exec(message ?? '');
      const indexMatch: RegExpMatchArray | null = /\{(\d+)\}/.exec(selector ?? '');
      return {
        index: indexMatch !== null ? Number.parseInt(indexMatch[1], 10) : position,
        message: message ?? '',
        branch: branchMatch !== null ? branchMatch[1].trim() : '',
        files: [],
      };
    });
}

/**
 * Parses `git diff-tree --name-status -r -z` output into the files a commit changed.
 * @param output The raw command output.
 * @returns Returns the changed files.
 */
export function parseCommitFiles(output: string): VcsFileChange[] {
  const tokens: string[] = output.split(NUL).filter((token: string): boolean => token.length > 0);
  const files: VcsFileChange[] = [];
  for (let index: number = 0; index < tokens.length; index++) {
    const letter: string = tokens[index][0];
    const renamed: boolean = letter === 'R' || letter === 'C';
    const previousPath: string | undefined = renamed ? tokens[index + 1] : undefined;
    const path: string | undefined = renamed ? tokens[index + 2] : tokens[index + 1];
    index += renamed ? 2 : 1;
    if (path === undefined) {
      break;
    }
    files.push(change(path, mapStatus(letter), previousPath));
  }
  return files;
}
