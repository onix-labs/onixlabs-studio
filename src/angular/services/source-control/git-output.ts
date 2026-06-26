import {
  GitBranch,
  GitChangeStatus,
  GitCommit,
  GitFileChange,
  GitRef,
  GitRemote,
  GitStash,
  GitTag,
} from '../repository/repository-data';

/**
 * The unit separator git is asked to put between fields (`%x1f` / `%1f`).
 */
const US: string = '\x1f';

/**
 * The record separator git is asked to put between commits (`%x1e`).
 */
const RS: string = '\x1e';

/**
 * The NUL byte git uses to separate entries under `-z`.
 */
const NUL: string = '\0';

/**
 * Describes a repository's working-tree status parsed from `git status --porcelain=v2 --branch`.
 */
export interface ParsedStatus {
  /**
   * Gets the current branch name, or null when the head is detached.
   */
  readonly branch: string | null;

  /**
   * Gets the upstream branch name, or null when there is none.
   */
  readonly upstream: string | null;

  /**
   * Gets the number of commits ahead of the upstream.
   */
  readonly ahead: number;

  /**
   * Gets the number of commits behind the upstream.
   */
  readonly behind: number;

  /**
   * Gets the staged changes (index versus HEAD).
   */
  readonly staged: readonly GitFileChange[];

  /**
   * Gets the unstaged changes (working tree versus index), including untracked files.
   */
  readonly unstaged: readonly GitFileChange[];
}

/**
 * Maps a porcelain status letter to the application's change status.
 * @param letter The git status letter (M, A, D, R, C, …).
 * @returns Returns the mapped change status.
 */
function mapStatus(letter: string): GitChangeStatus {
  switch (letter) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'renamed';
    default:
      return 'modified';
  }
}

/**
 * Builds a working-tree file change with a diff target, defaulting line tallies to zero (porcelain
 * status does not carry them).
 * @param path The file path.
 * @param status The change status.
 * @param staged Whether the change is staged.
 * @param previousPath The pre-rename path, when renamed.
 * @returns Returns the file change.
 */
function workingChange(
  path: string,
  status: GitChangeStatus,
  staged: boolean,
  previousPath?: string,
): GitFileChange {
  return {
    path,
    previousPath,
    status,
    additions: 0,
    deletions: 0,
    language: '',
    original: '',
    modified: '',
    target: { kind: 'working', staged },
  };
}

/**
 * Parses `git status --porcelain=v2 --branch -z` output into the branch header and the staged and
 * unstaged changes. The NUL-delimited stream interleaves header lines, ordinary/rename entries (whose
 * rename form carries a second, separately-delimited path), and untracked entries.
 * @param output The raw command output.
 * @returns Returns the parsed status.
 */
export function parseStatus(output: string): ParsedStatus {
  const tokens: string[] = output.split(NUL).filter((token: string): boolean => token.length > 0);
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead: number = 0;
  let behind: number = 0;
  const staged: GitFileChange[] = [];
  const unstaged: GitFileChange[] = [];

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
      const stagedLetter: string = xy[0];
      const worktreeLetter: string = xy[1];
      if (stagedLetter !== '.') {
        staged.push(workingChange(path, mapStatus(stagedLetter), true, previousPath));
      }
      if (worktreeLetter !== '.') {
        unstaged.push(workingChange(path, mapStatus(worktreeLetter), false, previousPath));
      }
      continue;
    }

    if (token.startsWith('? ')) {
      unstaged.push(workingChange(token.slice(2), 'added', false));
    }
    // '! ' (ignored) and 'u ' (unmerged) entries are skipped in this read-only slice.
  }

  return { branch, upstream, ahead, behind, staged, unstaged };
}

/**
 * Parses a `%D` ref-decoration string (for example `HEAD -> main, origin/main, tag: v1.0`) into refs.
 * @param decoration The decoration string.
 * @returns Returns the parsed refs.
 */
function parseDecorations(decoration: string): GitRef[] {
  const trimmed: string = decoration.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const refs: GitRef[] = [];
  for (const raw of trimmed.split(', ')) {
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
 * Parses the custom-format `git log` output into commits with parents, refs, and metadata. The files
 * of each commit are loaded separately, so they start empty.
 * @param output The raw command output.
 * @returns Returns the commits, newest first.
 */
export function parseLog(output: string): GitCommit[] {
  return output
    .split(RS)
    .map((record: string): string => record.replace(/^\r?\n/, ''))
    .filter((record: string): boolean => record.trim().length > 0)
    .map((record: string): GitCommit => {
      const f: string[] = record.split(US);
      const parents: string[] = (f[2] ?? '').trim().length > 0 ? f[2].trim().split(' ') : [];
      return {
        hash: f[0] ?? '',
        shortHash: f[1] ?? '',
        parents,
        author: f[3] ?? '',
        email: f[4] ?? '',
        isoDate: f[5] ?? '',
        relativeDate: f[6] ?? '',
        refs: parseDecorations(f[7] ?? ''),
        summary: f[8] ?? '',
        body: (f[9] ?? '').trim(),
        files: [],
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
 * Describes the refs parsed from `git for-each-ref`: local branches, grouped remotes, and tags.
 */
export interface ParsedRefs {
  /**
   * Gets the local branches.
   */
  readonly branches: readonly GitBranch[];

  /**
   * Gets the remotes, grouped by remote name.
   */
  readonly remotes: readonly GitRemote[];

  /**
   * Gets the tags.
   */
  readonly tags: readonly GitTag[];
}

/**
 * Parses the custom-format `git for-each-ref` output into local branches, remotes, and tags.
 * @param output The raw command output.
 * @returns Returns the parsed refs.
 */
export function parseRefs(output: string): ParsedRefs {
  const branches: GitBranch[] = [];
  const tags: GitTag[] = [];
  const remoteBranches: Map<string, string[]> = new Map<string, string[]>();

  for (const line of output.split('\n')) {
    if (line.trim().length === 0) {
      continue;
    }
    const [refName, objectName, head, upstreamShort, track]: string[] = line.split(US);
    if (refName.startsWith('refs/heads/')) {
      const name: string = refName.slice('refs/heads/'.length);
      const counts: { ahead: number; behind: number } = parseTrack(track ?? '');
      branches.push({
        name,
        current: head === '*',
        upstream:
          upstreamShort !== undefined && upstreamShort.length > 0 ? upstreamShort : undefined,
        ahead: counts.ahead,
        behind: counts.behind,
        tip: objectName,
      });
    } else if (refName.startsWith('refs/remotes/')) {
      const short: string = refName.slice('refs/remotes/'.length);
      const remoteName: string = short.split('/')[0];
      const list: string[] = remoteBranches.get(remoteName) ?? [];
      list.push(short);
      remoteBranches.set(remoteName, list);
    } else if (refName.startsWith('refs/tags/')) {
      tags.push({ name: refName.slice('refs/tags/'.length), commit: objectName });
    }
  }

  const remotes: GitRemote[] = [...remoteBranches.entries()].map(
    ([name, list]: [string, string[]]): GitRemote => ({ name, url: '', branches: list }),
  );
  return { branches, remotes, tags };
}

/**
 * Parses the custom-format `git stash list` output into stash entries.
 * @param output The raw command output.
 * @returns Returns the stashes, newest first.
 */
export function parseStashes(output: string): GitStash[] {
  return output
    .split('\n')
    .filter((line: string): boolean => line.trim().length > 0)
    .map((line: string, index: number): GitStash => {
      const [selector, , message]: string[] = line.split(US);
      const branchMatch: RegExpMatchArray | null = /\bon ([^:]+):/i.exec((message ?? ''));
      return {
        index: parseStashIndex(selector, index),
        message: message ?? '',
        branch: branchMatch !== null ? branchMatch[1].trim() : '',
        files: [],
      };
    });
}

/**
 * Extracts the numeric index from a stash selector (for example `stash@{2}`), falling back to the
 * entry's position.
 * @param selector The stash selector.
 * @param fallback The fallback index.
 * @returns Returns the stash index.
 */
function parseStashIndex(selector: string, fallback: number): number {
  const match: RegExpMatchArray | null = /\{(\d+)\}/.exec((selector ?? ''));
  return match !== null ? Number.parseInt(match[1], 10) : fallback;
}

/**
 * Parses `git diff-tree --name-status -r -z` output into the files changed by a commit, attaching a
 * commit diff target so each file's contents can be loaded lazily.
 * @param output The raw command output.
 * @param hash The commit hash.
 * @param parent The commit's first-parent hash, or null for a root commit.
 * @returns Returns the changed files.
 */
export function parseCommitFiles(
  output: string,
  hash: string,
  parent: string | null,
): GitFileChange[] {
  const tokens: string[] = output.split(NUL).filter((token: string): boolean => token.length > 0);
  const files: GitFileChange[] = [];
  for (let index: number = 0; index < tokens.length; index++) {
    const code: string = tokens[index];
    const letter: string = code[0];
    const renamed: boolean = letter === 'R' || letter === 'C';
    const previousPath: string | undefined = renamed ? tokens[index + 1] : undefined;
    const path: string = renamed ? tokens[index + 2] : tokens[index + 1];
    index += renamed ? 2 : 1;
    if (path === undefined) {
      break;
    }
    files.push({
      path,
      previousPath,
      status: mapStatus(letter),
      additions: 0,
      deletions: 0,
      language: '',
      original: '',
      modified: '',
      target: { kind: 'commit', hash, parent },
    });
  }
  return files;
}
