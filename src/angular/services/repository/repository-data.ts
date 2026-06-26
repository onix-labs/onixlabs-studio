/**
 * Specifies the kind of reference a {@link GitRef} names.
 */
export type GitRefKind = 'head' | 'branch' | 'remote' | 'tag';

/**
 * Names a reference (the current head, a local branch, a remote-tracking branch, or a tag) that
 * points at a commit, shown as a badge in the graph.
 */
export interface GitRef {
  /**
   * Gets the reference name (for example `main` or `v0.5.0`).
   */
  readonly name: string;

  /**
   * Gets the kind of reference.
   */
  readonly kind: GitRefKind;
}

/**
 * Specifies how a file changed relative to its parent.
 */
export type GitChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

/**
 * Describes a single changed file: its path, how it changed, the line tallies, and the before/after
 * content the Monaco diff surface compares.
 */
export interface GitFileChange {
  /**
   * Gets the file path relative to the repository root.
   */
  readonly path: string;

  /**
   * Gets the previous path when the file was renamed.
   */
  readonly previousPath?: string;

  /**
   * Gets how the file changed.
   */
  readonly status: GitChangeStatus;

  /**
   * Gets the number of added lines.
   */
  readonly additions: number;

  /**
   * Gets the number of removed lines.
   */
  readonly deletions: number;

  /**
   * Gets the Monaco language identifier used to syntax-highlight the diff.
   */
  readonly language: string;

  /**
   * Gets the file's content before the change (the diff's original side). Empty for an added file.
   */
  readonly original: string;

  /**
   * Gets the file's content after the change (the diff's modified side). Empty for a deleted file.
   */
  readonly modified: string;
}

/**
 * Describes a single commit in the history.
 */
export interface GitCommit {
  /**
   * Gets the full commit hash.
   */
  readonly hash: string;

  /**
   * Gets the abbreviated commit hash.
   */
  readonly shortHash: string;

  /**
   * Gets the first line of the commit message.
   */
  readonly summary: string;

  /**
   * Gets the remainder of the commit message, or an empty string when there is none.
   */
  readonly body: string;

  /**
   * Gets the author's name.
   */
  readonly author: string;

  /**
   * Gets the author's email.
   */
  readonly email: string;

  /**
   * Gets a human-readable relative date (for example `2 days ago`).
   */
  readonly relativeDate: string;

  /**
   * Gets the absolute date label.
   */
  readonly isoDate: string;

  /**
   * Gets the parent commit hashes; more than one denotes a merge.
   */
  readonly parents: readonly string[];

  /**
   * Gets the references that point at this commit.
   */
  readonly refs: readonly GitRef[];

  /**
   * Gets the files changed by this commit.
   */
  readonly files: readonly GitFileChange[];
}

/**
 * Describes a local branch and its divergence from its upstream.
 */
export interface GitBranch {
  /**
   * Gets the branch name.
   */
  readonly name: string;

  /**
   * Gets a value indicating whether this is the checked-out branch.
   */
  readonly current: boolean;

  /**
   * Gets the upstream branch name, or undefined when the branch has no upstream.
   */
  readonly upstream?: string;

  /**
   * Gets the number of commits ahead of the upstream.
   */
  readonly ahead: number;

  /**
   * Gets the number of commits behind the upstream.
   */
  readonly behind: number;

  /**
   * Gets the hash of the branch's tip commit.
   */
  readonly tip: string;
}

/**
 * Describes a configured remote.
 */
export interface GitRemote {
  /**
   * Gets the remote name.
   */
  readonly name: string;

  /**
   * Gets the remote URL.
   */
  readonly url: string;

  /**
   * Gets the remote-tracking branch names.
   */
  readonly branches: readonly string[];
}

/**
 * Describes a tag.
 */
export interface GitTag {
  /**
   * Gets the tag name.
   */
  readonly name: string;

  /**
   * Gets the hash of the commit the tag points at.
   */
  readonly commit: string;
}

/**
 * Describes a stash entry.
 */
export interface GitStash {
  /**
   * Gets the stack index (0 is the most recent).
   */
  readonly index: number;

  /**
   * Gets the stash message.
   */
  readonly message: string;

  /**
   * Gets the branch the stash was taken from.
   */
  readonly branch: string;

  /**
   * Gets the files captured by the stash.
   */
  readonly files: readonly GitFileChange[];
}

/**
 * Represents one row of the commit graph: a commit (or the synthetic working-tree node) resolved to a
 * lane, a colour, and the edges that connect it down to its parents.
 */
export interface GraphNode {
  /**
   * Gets the node identifier (a commit hash, or the working-tree sentinel).
   */
  readonly id: string;

  /**
   * Gets the node kind.
   */
  readonly kind: 'commit' | 'working';

  /**
   * Gets the zero-based row index.
   */
  readonly row: number;

  /**
   * Gets the zero-based lane (graph column) the node's dot sits in.
   */
  readonly lane: number;

  /**
   * Gets the lane colour.
   */
  readonly color: string;

  /**
   * Gets the backing commit, or null for the working-tree node.
   */
  readonly commit: GitCommit | null;

  /**
   * Gets the references that point at this node.
   */
  readonly refs: readonly GitRef[];

  /**
   * Gets the edges descending from this node to each of its parents.
   */
  readonly edges: readonly {
    /**
     * Gets the parent's row index.
     */
    readonly toRow: number;

    /**
     * Gets the parent's lane.
     */
    readonly toLane: number;

    /**
     * Gets the edge colour (the parent lane's colour).
     */
    readonly color: string;
  }[];
}

// --- Seed content -----------------------------------------------------------------------------

/**
 * Holds the README before the source-control work, used by the working-tree diff.
 */
const README_BEFORE: string = `# ONIXLabs Studio

A modular Angular + Electron workspace.

## Features

- Dockable IDE shell
- Monaco code editor
- Integrated terminal
`;

/**
 * Holds the README after the source-control work, used by the working-tree diff.
 */
const README_AFTER: string = `# ONIXLabs Studio

A modular Angular + Electron workspace.

## Features

- Dockable IDE shell
- Monaco code editor
- Integrated terminal
- Visual source control
- Side-by-side diffs powered by Monaco
`;

/**
 * Holds the tab-type registry before source control was added, used by the working-tree diff.
 */
const TAB_BEFORE: string = `export type TabType =
  | 'directory'
  | 'code'
  | 'markdown'
  | 'terminal'
  | 'agent'
  | 'settings';
`;

/**
 * Holds the tab-type registry after source control was added, used by the working-tree diff.
 */
const TAB_AFTER: string = `export type TabType =
  | 'directory'
  | 'code'
  | 'markdown'
  | 'terminal'
  | 'agent'
  | 'source-control'
  | 'settings';
`;

/**
 * Holds the seeded staged changes shown when the working-tree node is selected.
 */
export const SEED_STAGED: readonly GitFileChange[] = [
  {
    path: 'src/angular/services/tabs/tab.ts',
    status: 'modified',
    additions: 1,
    deletions: 0,
    language: 'typescript',
    original: TAB_BEFORE,
    modified: TAB_AFTER,
  },
];

/**
 * Holds the seeded unstaged changes shown when the working-tree node is selected.
 */
export const SEED_UNSTAGED: readonly GitFileChange[] = [
  {
    path: 'README.md',
    status: 'modified',
    additions: 2,
    deletions: 0,
    language: 'markdown',
    original: README_BEFORE,
    modified: README_AFTER,
  },
  {
    path: 'src/angular/services/repository/repository.ts',
    status: 'added',
    additions: 4,
    deletions: 0,
    language: 'typescript',
    original: '',
    modified: `@Service()
export class Repository {
  public readonly commits = signal<readonly GitCommit[]>([]);
}
`,
  },
];

/**
 * Holds the seeded commit history, newest first. Every parent appears later in the list so the
 * graph's lane-assignment pass can resolve it. A feature branch diverges at `Refine ribbon tokens`
 * and merges back at `Merge feature/terminal`, so the graph shows a second lane.
 */
export const SEED_COMMITS: readonly GitCommit[] = [
  {
    hash: 'a1b2c3d4e5f60718',
    shortHash: 'a1b2c3d',
    summary: 'Scaffold source-control view',
    body: 'Add the GitKraken-style repository surface with its own ribbon and status bar.',
    author: 'Matthew Layton',
    email: 'matthew.layton@live.co.uk',
    relativeDate: '2 hours ago',
    isoDate: '2026-06-26 12:30',
    parents: ['b2c3d4e5f6071829'],
    refs: [
      { name: 'HEAD', kind: 'head' },
      { name: 'main', kind: 'branch' },
    ],
    files: [
      {
        path: 'src/angular/components/views/source-control-view/source-control-view.ts',
        status: 'modified',
        additions: 18,
        deletions: 4,
        language: 'typescript',
        original: `export class SourceControlView {
  public readonly isActive = input<boolean>(false);
}
`,
        modified: `export class SourceControlView {
  private readonly repository = inject(Repository);
  public readonly isActive = input<boolean>(false);

  protected readonly graph = this.repository.graph;
}
`,
      },
    ],
  },
  {
    hash: 'b2c3d4e5f6071829',
    shortHash: 'b2c3d4e',
    summary: 'Add Monaco editor integration',
    body: '',
    author: 'Matthew Layton',
    email: 'matthew.layton@live.co.uk',
    relativeDate: 'yesterday',
    isoDate: '2026-06-25 17:05',
    parents: ['c3d4e5f607182930'],
    refs: [{ name: 'origin/main', kind: 'remote' }],
    files: [
      {
        path: 'src/angular/services/monaco/monaco.ts',
        status: 'added',
        additions: 42,
        deletions: 0,
        language: 'typescript',
        original: '',
        modified: `@Service()
export class Monaco {
  public ensureLoaded(): Promise<void> {
    this.loadPromise ??= this.load();
    return this.loadPromise;
  }
}
`,
      },
    ],
  },
  {
    hash: 'c3d4e5f607182930',
    shortHash: 'c3d4e5f',
    summary: 'Merge feature/terminal',
    body: 'Bring the integrated terminal onto main.',
    author: 'Matthew Layton',
    email: 'matthew.layton@live.co.uk',
    relativeDate: '3 days ago',
    isoDate: '2026-06-23 09:40',
    parents: ['d4e5f60718293041', 'f6071829304152a3'],
    refs: [],
    files: [
      {
        path: 'src/angular/components/views/terminal-view/terminal-view.ts',
        status: 'added',
        additions: 30,
        deletions: 0,
        language: 'typescript',
        original: '',
        modified: `export class TerminalView {
  public readonly terminalId = input.required<string>();
}
`,
      },
    ],
  },
  {
    hash: 'f6071829304152a3',
    shortHash: 'f607182',
    summary: 'Add xterm integration',
    body: '',
    author: 'Dana Scott',
    email: 'dana@example.com',
    relativeDate: '4 days ago',
    isoDate: '2026-06-22 14:12',
    parents: ['e5f6071829304152'],
    refs: [{ name: 'feature/terminal', kind: 'branch' }],
    files: [
      {
        path: 'package.json',
        status: 'modified',
        additions: 2,
        deletions: 1,
        language: 'json',
        original: `{
  "dependencies": {
    "@angular/core": "^19.0.0"
  }
}
`,
        modified: `{
  "dependencies": {
    "@angular/core": "^19.0.0",
    "@xterm/xterm": "^5.5.0"
  }
}
`,
      },
    ],
  },
  {
    hash: 'e5f6071829304152',
    shortHash: 'e5f6071',
    summary: 'Scaffold terminal view',
    body: '',
    author: 'Dana Scott',
    email: 'dana@example.com',
    relativeDate: '4 days ago',
    isoDate: '2026-06-22 11:48',
    parents: ['d4e5f60718293041'],
    refs: [],
    files: [
      {
        path: 'src/angular/components/views/terminal-view/terminal-view.html',
        status: 'added',
        additions: 3,
        deletions: 0,
        language: 'html',
        original: '',
        modified: `<div class="terminal" #host></div>
`,
      },
    ],
  },
  {
    hash: 'd4e5f60718293041',
    shortHash: 'd4e5f60',
    summary: 'Refine ribbon tokens',
    body: '',
    author: 'Matthew Layton',
    email: 'matthew.layton@live.co.uk',
    relativeDate: '5 days ago',
    isoDate: '2026-06-21 16:20',
    parents: ['07182930415263b4'],
    refs: [{ name: 'v0.1.0', kind: 'tag' }],
    files: [
      {
        path: 'src/angular/styles/_theme-dark.scss',
        status: 'modified',
        additions: 3,
        deletions: 1,
        language: 'scss',
        original: `@mixin theme-dark {
  --ribbon-strip-background-color: var(--gray-900);
}
`,
        modified: `@mixin theme-dark {
  --ribbon-strip-background-color: var(--gray-800);
  --ribbon-group-border-color: var(--gray-900);
  --ribbon-control-foreground-color: var(--gray-100);
}
`,
      },
    ],
  },
  {
    hash: '07182930415263b4',
    shortHash: '0718293',
    summary: 'Wire ribbon strip',
    body: '',
    author: 'Matthew Layton',
    email: 'matthew.layton@live.co.uk',
    relativeDate: '6 days ago',
    isoDate: '2026-06-20 10:02',
    parents: ['182930415263b4c5'],
    refs: [],
    files: [
      {
        path: 'src/angular/components/strips/ribbon-strip/ribbon-strip-container/ribbon-strip-container.ts',
        status: 'added',
        additions: 12,
        deletions: 0,
        language: 'typescript',
        original: '',
        modified: `export class RibbonStripContainer {
  protected readonly activeType = computed(() => this.tabs.activeTab()?.type);
}
`,
      },
    ],
  },
  {
    hash: '182930415263b4c5',
    shortHash: '1829304',
    summary: 'Add dock framework',
    body: '',
    author: 'Matthew Layton',
    email: 'matthew.layton@live.co.uk',
    relativeDate: 'last week',
    isoDate: '2026-06-18 19:30',
    parents: ['930415263b4c5d6e'],
    refs: [],
    files: [
      {
        path: 'src/angular/services/dock/dock-state.ts',
        status: 'added',
        additions: 56,
        deletions: 0,
        language: 'typescript',
        original: '',
        modified: `@Service()
export class DockState {
  public dockEdge(panelId: string, side: Side): void {}
}
`,
      },
    ],
  },
  {
    hash: '930415263b4c5d6e',
    shortHash: '9304152',
    summary: 'Initialize Studio shell',
    body: '',
    author: 'Matthew Layton',
    email: 'matthew.layton@live.co.uk',
    relativeDate: 'last week',
    isoDate: '2026-06-17 08:15',
    parents: [],
    refs: [],
    files: [
      {
        path: 'angular.json',
        status: 'added',
        additions: 40,
        deletions: 0,
        language: 'json',
        original: '',
        modified: `{
  "projects": {
    "onixlabs-studio": {}
  }
}
`,
      },
    ],
  },
];

/**
 * Holds the seeded local branches.
 */
export const SEED_BRANCHES: readonly GitBranch[] = [
  {
    name: 'main',
    current: true,
    upstream: 'origin/main',
    ahead: 1,
    behind: 0,
    tip: 'a1b2c3d4e5f60718',
  },
  {
    name: 'feature/terminal',
    current: false,
    upstream: 'origin/feature/terminal',
    ahead: 0,
    behind: 2,
    tip: 'f6071829304152a3',
  },
  {
    name: 'feature/lsp-spike',
    current: false,
    ahead: 3,
    behind: 0,
    tip: 'b2c3d4e5f6071829',
  },
];

/**
 * Holds the seeded remotes.
 */
export const SEED_REMOTES: readonly GitRemote[] = [
  {
    name: 'origin',
    url: 'git@github.com:ONIXLabs/onixlabs-studio.git',
    branches: ['origin/main', 'origin/feature/terminal'],
  },
];

/**
 * Holds the seeded tags.
 */
export const SEED_TAGS: readonly GitTag[] = [{ name: 'v0.1.0', commit: 'd4e5f60718293041' }];

/**
 * Holds the seeded stashes.
 */
export const SEED_STASHES: readonly GitStash[] = [
  {
    index: 0,
    message: 'WIP on main: experiment with graph colours',
    branch: 'main',
    files: [
      {
        path: 'src/angular/services/repository/repository.ts',
        status: 'modified',
        additions: 2,
        deletions: 2,
        language: 'typescript',
        original: `const LANE_COLORS = ['#5073b8', '#07b39b'];
`,
        modified: `const LANE_COLORS = ['#1098ad', '#6fba82'];
`,
      },
    ],
  },
];
