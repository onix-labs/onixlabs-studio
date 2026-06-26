import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Icon } from '../../icons/icon';
import {
  GitBranch,
  GitCommit,
  GitFileChange,
  GitRef,
  GitRemote,
  GitStash,
  GitTag,
  GraphNode,
  SEED_BRANCHES,
  SEED_COMMITS,
  SEED_REMOTES,
  SEED_STAGED,
  SEED_STASHES,
  SEED_TAGS,
  SEED_UNSTAGED,
} from './repository-data';

/**
 * Identifies the synthetic graph node that represents the uncommitted working tree, sitting above the
 * first real commit so staged and unstaged changes have a selectable row in the history graph.
 */
export const WORKING_NODE_ID: string = 'working';

/**
 * The lane colours, cycled by lane index, that tint the commit-graph edges and nodes. Drawn from the
 * accent palette in `_variables.scss` so the graph reads as part of the application's colour world.
 */
const LANE_COLORS: readonly string[] = ['#5073b8', '#07b39b', '#ef4e7b', '#f79533', '#a166ab'];

/**
 * Holds a lane's expected next commit while the lane-assignment pass walks the history, or null when
 * the lane is free. Indexed by lane number.
 */
type LaneSlots = (string | null)[];

/**
 * Represents the in-memory model of a single Git repository surfaced by the source-control view: its
 * branches, remotes, tags, stashes, and commit history, together with the working-tree changes and
 * the user's current selection (commit and file) that drives the detail and diff panes.
 *
 * The data is mock scaffolding rather than a live Git binding — the goal is to exercise the view, its
 * ribbon, its status bar, and the Monaco diff surface end to end. The mutating verbs the ribbon calls
 * (commit, push, pull, stash, …) move this mock state in believable ways so the wiring is visible.
 */
@Service()
export class Repository {
  /**
   * Holds the repository's display name.
   */
  private readonly repoNameSignal: WritableSignal<string> = signal<string>('onixlabs-studio');

  /**
   * Holds the local branches.
   */
  private readonly branchesSignal: WritableSignal<readonly GitBranch[]> =
    signal<readonly GitBranch[]>(SEED_BRANCHES);

  /**
   * Holds the configured remotes.
   */
  private readonly remotesSignal: WritableSignal<readonly GitRemote[]> =
    signal<readonly GitRemote[]>(SEED_REMOTES);

  /**
   * Holds the tags.
   */
  private readonly tagsSignal: WritableSignal<readonly GitTag[]> =
    signal<readonly GitTag[]>(SEED_TAGS);

  /**
   * Holds the stashes, newest first.
   */
  private readonly stashesSignal: WritableSignal<readonly GitStash[]> =
    signal<readonly GitStash[]>(SEED_STASHES);

  /**
   * Holds the commit history, newest first. Every parent referenced by a commit appears later in the
   * list, so the lane-assignment pass can resolve each parent's position.
   */
  private readonly commitsSignal: WritableSignal<readonly GitCommit[]> =
    signal<readonly GitCommit[]>(SEED_COMMITS);

  /**
   * Holds the staged working-tree changes.
   */
  private readonly stagedSignal: WritableSignal<readonly GitFileChange[]> =
    signal<readonly GitFileChange[]>(SEED_STAGED);

  /**
   * Holds the unstaged working-tree changes.
   */
  private readonly unstagedSignal: WritableSignal<readonly GitFileChange[]> =
    signal<readonly GitFileChange[]>(SEED_UNSTAGED);

  /**
   * Holds the identifier of the selected graph node (a commit hash or {@link WORKING_NODE_ID}), or
   * null when nothing is selected.
   */
  private readonly selectedNodeSignal: WritableSignal<string | null> = signal<string | null>(
    WORKING_NODE_ID,
  );

  /**
   * Holds the path of the selected file within the selected node, or null to fall back to the node's
   * first file.
   */
  private readonly selectedFileSignal: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Tracks the running counter used to fabricate commit hashes for mock commits.
   */
  private sequence: number = 0;

  /**
   * Gets the repository's display name.
   */
  public readonly repoName: Signal<string> = this.repoNameSignal.asReadonly();

  /**
   * Gets the local branches.
   */
  public readonly branches: Signal<readonly GitBranch[]> = this.branchesSignal.asReadonly();

  /**
   * Gets the configured remotes.
   */
  public readonly remotes: Signal<readonly GitRemote[]> = this.remotesSignal.asReadonly();

  /**
   * Gets the tags.
   */
  public readonly tags: Signal<readonly GitTag[]> = this.tagsSignal.asReadonly();

  /**
   * Gets the stashes, newest first.
   */
  public readonly stashes: Signal<readonly GitStash[]> = this.stashesSignal.asReadonly();

  /**
   * Gets the commit history, newest first.
   */
  public readonly commits: Signal<readonly GitCommit[]> = this.commitsSignal.asReadonly();

  /**
   * Gets the staged working-tree changes.
   */
  public readonly staged: Signal<readonly GitFileChange[]> = this.stagedSignal.asReadonly();

  /**
   * Gets the unstaged working-tree changes.
   */
  public readonly unstaged: Signal<readonly GitFileChange[]> = this.unstagedSignal.asReadonly();

  /**
   * Gets the identifier of the selected graph node, or null when nothing is selected.
   */
  public readonly selectedNodeId: Signal<string | null> = this.selectedNodeSignal.asReadonly();

  /**
   * Gets the current branch, or undefined when the head is detached.
   */
  public readonly currentBranch: Signal<GitBranch | undefined> = computed(
    (): GitBranch | undefined =>
      this.branchesSignal().find((branch: GitBranch): boolean => branch.current),
  );

  /**
   * Gets the total number of changed files in the working tree (staged and unstaged).
   */
  public readonly changeCount: Signal<number> = computed(
    (): number => this.stagedSignal().length + this.unstagedSignal().length,
  );

  /**
   * Gets the commit-graph rows: the optional working-tree node followed by every commit, each
   * resolved to a lane, colour, and the edges that connect it to its parents. This is the single
   * source the {@link GraphNode}-driven graph renders from.
   */
  public readonly graph: Signal<readonly GraphNode[]> = computed((): readonly GraphNode[] =>
    this.buildGraph(this.commitsSignal(), this.changeCount() > 0),
  );

  /**
   * Gets the selected commit, or null when the working tree (or nothing) is selected.
   */
  public readonly selectedCommit: Signal<GitCommit | null> = computed((): GitCommit | null => {
    const id: string | null = this.selectedNodeSignal();
    if (id === null || id === WORKING_NODE_ID) {
      return null;
    }
    return this.commitsSignal().find((commit: GitCommit): boolean => commit.hash === id) ?? null;
  });

  /**
   * Gets the changed files for the selected node: the selected commit's files, or the merged working
   * tree (staged then unstaged) when the working node is selected.
   */
  public readonly selectedFiles: Signal<readonly GitFileChange[]> = computed(
    (): readonly GitFileChange[] => {
      if (this.selectedNodeSignal() === WORKING_NODE_ID) {
        return [...this.stagedSignal(), ...this.unstagedSignal()];
      }
      return this.selectedCommit()?.files ?? [];
    },
  );

  /**
   * Gets the file whose diff is shown, defaulting to the first file of the selected node when no file
   * has been explicitly chosen.
   */
  public readonly selectedFile: Signal<GitFileChange | null> = computed(
    (): GitFileChange | null => {
      const files: readonly GitFileChange[] = this.selectedFiles();
      if (files.length === 0) {
        return null;
      }
      const path: string | null = this.selectedFileSignal();
      return files.find((file: GitFileChange): boolean => file.path === path) ?? files[0];
    },
  );

  /**
   * Gets a value indicating whether the working-tree node is selected.
   */
  public readonly isWorkingSelected: Signal<boolean> = computed(
    (): boolean => this.selectedNodeSignal() === WORKING_NODE_ID,
  );

  /**
   * Selects a graph node (a commit hash or {@link WORKING_NODE_ID}), resetting the file selection so
   * the diff falls back to the node's first file.
   * @param nodeId The identifier of the node to select.
   */
  public selectNode(nodeId: string): void {
    this.selectedNodeSignal.set(nodeId);
    this.selectedFileSignal.set(null);
  }

  /**
   * Selects a file within the selected node, driving the diff surface.
   * @param path The path of the file to select.
   */
  public selectFile(path: string): void {
    this.selectedFileSignal.set(path);
  }

  /**
   * Stages every unstaged change, mirroring "stage all".
   */
  public stageAll(): void {
    this.stagedSignal.update((staged: readonly GitFileChange[]): readonly GitFileChange[] => [
      ...staged,
      ...this.unstagedSignal(),
    ]);
    this.unstagedSignal.set([]);
  }

  /**
   * Unstages every staged change, mirroring "unstage all".
   */
  public unstageAll(): void {
    this.unstagedSignal.update((unstaged: readonly GitFileChange[]): readonly GitFileChange[] => [
      ...this.stagedSignal(),
      ...unstaged,
    ]);
    this.stagedSignal.set([]);
  }

  /**
   * Commits the staged changes as a new commit on the current branch, clearing the staging area and
   * advancing the branch tip. A no-op when nothing is staged.
   * @param summary The commit summary; a default is used when blank.
   */
  public commit(summary: string): void {
    const staged: readonly GitFileChange[] = this.stagedSignal();
    if (staged.length === 0) {
      return;
    }
    const branch: GitBranch | undefined = this.currentBranch();
    const parent: GitCommit | undefined = this.commitsSignal()[0];
    this.sequence += 1;
    const hash: string = `${this.sequence.toString(16).padStart(7, '0')}feed00`;
    const trimmed: string = summary.trim();
    const newCommit: GitCommit = {
      hash,
      shortHash: hash.slice(0, 7),
      summary: trimmed.length > 0 ? trimmed : 'Update working tree',
      body: '',
      author: 'Matthew Layton',
      email: 'matthew.layton@live.co.uk',
      relativeDate: 'just now',
      isoDate: 'now',
      parents: parent === undefined ? [] : [parent.hash],
      refs: branch === undefined ? [] : [{ name: branch.name, kind: 'head' }],
      files: staged,
    };

    // Move the head ref from the old tip onto the new commit, then prepend the new commit.
    this.commitsSignal.update((commits: readonly GitCommit[]): readonly GitCommit[] => [
      newCommit,
      ...commits.map(
        (commit: GitCommit): GitCommit =>
          commit.refs.some((ref: GitRef): boolean => ref.kind === 'head')
            ? { ...commit, refs: commit.refs.filter((ref: GitRef): boolean => ref.kind !== 'head') }
            : commit,
      ),
    ]);
    this.stagedSignal.set([]);
    if (branch !== undefined) {
      this.updateBranch(branch.name, { tip: hash, ahead: branch.ahead + 1 });
    }
    this.selectNode(hash);
  }

  /**
   * Pushes the current branch, clearing its ahead count.
   */
  public push(): void {
    const branch: GitBranch | undefined = this.currentBranch();
    if (branch !== undefined) {
      this.updateBranch(branch.name, { ahead: 0 });
    }
  }

  /**
   * Pulls the current branch, clearing its behind count.
   */
  public pull(): void {
    const branch: GitBranch | undefined = this.currentBranch();
    if (branch !== undefined) {
      this.updateBranch(branch.name, { behind: 0 });
    }
  }

  /**
   * Stashes the working-tree changes, moving them into a new stash and clearing the working tree.
   */
  public stash(): void {
    const files: readonly GitFileChange[] = [...this.stagedSignal(), ...this.unstagedSignal()];
    if (files.length === 0) {
      return;
    }
    const branch: GitBranch | undefined = this.currentBranch();
    this.stashesSignal.update((stashes: readonly GitStash[]): readonly GitStash[] => [
      {
        index: 0,
        message: `WIP on ${branch?.name ?? 'HEAD'}`,
        branch: branch?.name ?? 'HEAD',
        files,
      },
      ...stashes.map((stash: GitStash): GitStash => ({ ...stash, index: stash.index + 1 })),
    ]);
    this.stagedSignal.set([]);
    this.unstagedSignal.set([]);
    if (this.selectedNodeSignal() === WORKING_NODE_ID) {
      this.selectNode(this.commitsSignal()[0]?.hash ?? WORKING_NODE_ID);
    }
  }

  /**
   * Creates a new local branch at the current tip and checks it out, mirroring "new branch". The name
   * is auto-generated so the scaffold needs no prompt.
   */
  public createBranch(): void {
    const tip: GitCommit | undefined = this.commitsSignal()[0];
    if (tip === undefined) {
      return;
    }
    this.sequence += 1;
    const name: string = `feature/branch-${this.sequence}`;
    this.branchesSignal.update((branches: readonly GitBranch[]): readonly GitBranch[] => [
      ...branches.map((branch: GitBranch): GitBranch => ({ ...branch, current: false })),
      { name, current: true, ahead: 0, behind: 0, tip: tip.hash },
    ]);
  }

  /**
   * Sets the current branch by name, clearing the head flag from the previous branch. Unknown names
   * are ignored.
   * @param name The name of the branch to check out.
   */
  public checkout(name: string): void {
    if (!this.branchesSignal().some((branch: GitBranch): boolean => branch.name === name)) {
      return;
    }
    this.branchesSignal.update((branches: readonly GitBranch[]): readonly GitBranch[] =>
      branches.map(
        (branch: GitBranch): GitBranch => ({ ...branch, current: branch.name === name }),
      ),
    );
  }

  /**
   * Gets the section icon for a ref kind, used by the sidebar and ref badges.
   * @param kind The ref kind.
   * @returns Returns the icon for the kind.
   */
  public iconForRef(kind: GitRef['kind']): Icon {
    switch (kind) {
      case 'tag':
        return Icon.TAG;
      case 'remote':
        return Icon.CLOUD;
      default:
        return Icon.SOURCE_CONTROL;
    }
  }

  /**
   * Applies a partial update to the branch with the given name.
   * @param name The name of the branch to update.
   * @param patch The fields to change.
   */
  private updateBranch(name: string, patch: Partial<GitBranch>): void {
    this.branchesSignal.update((branches: readonly GitBranch[]): readonly GitBranch[] =>
      branches.map(
        (branch: GitBranch): GitBranch => (branch.name === name ? { ...branch, ...patch } : branch),
      ),
    );
  }

  /**
   * Builds the commit-graph rows from the history, assigning each commit a lane and resolving the
   * edges to its parents. When the working tree is dirty, a synthetic node is prepended on the tip's
   * lane so uncommitted changes are selectable in the graph.
   * @param commits The commit history, newest first.
   * @param hasWorking Whether the working tree has changes worth a node.
   * @returns Returns the ordered graph rows.
   */
  private buildGraph(commits: readonly GitCommit[], hasWorking: boolean): readonly GraphNode[] {
    const placement: Map<string, { lane: number; color: string }> = this.assignLanes(commits);
    const rowOffset: number = hasWorking ? 1 : 0;
    const rowOf: Map<string, number> = new Map<string, number>(
      commits.map((commit: GitCommit, index: number): [string, number] => [
        commit.hash,
        index + rowOffset,
      ]),
    );

    const nodes: GraphNode[] = commits.map((commit: GitCommit, index: number): GraphNode => {
      const place: { lane: number; color: string } = placement.get(commit.hash) ?? {
        lane: 0,
        color: LANE_COLORS[0],
      };
      const edges: GraphNode['edges'] = commit.parents
        .map((parentHash: string): GraphNode['edges'][number] | null => {
          const parentRow: number | undefined = rowOf.get(parentHash);
          const parentPlace: { lane: number; color: string } | undefined =
            placement.get(parentHash);
          if (parentRow === undefined || parentPlace === undefined) {
            return null;
          }
          // A merge (second-or-later parent) takes its own lane's colour; the first parent continues
          // this commit's lane, so it keeps this commit's colour.
          return { toRow: parentRow, toLane: parentPlace.lane, color: parentPlace.color };
        })
        .filter(
          (edge: GraphNode['edges'][number] | null): edge is GraphNode['edges'][number] =>
            edge !== null,
        );

      return {
        id: commit.hash,
        kind: 'commit',
        row: index + rowOffset,
        lane: place.lane,
        color: place.color,
        commit,
        refs: commit.refs,
        edges,
      };
    });

    if (!hasWorking) {
      return nodes;
    }

    const tip: GraphNode | undefined = nodes[0];
    const workingNode: GraphNode = {
      id: WORKING_NODE_ID,
      kind: 'working',
      row: 0,
      lane: tip?.lane ?? 0,
      color: tip?.color ?? LANE_COLORS[0],
      commit: null,
      refs: [],
      edges: tip === undefined ? [] : [{ toRow: tip.row, toLane: tip.lane, color: tip.color }],
    };
    return [workingNode, ...nodes];
  }

  /**
   * Assigns each commit a lane and colour using the standard descending-history sweep: a commit takes
   * the lane that expects it (or a fresh lane), its first parent inherits that lane, and any further
   * parents (a merge) open new lanes.
   * @param commits The commit history, newest first.
   * @returns Returns a map of commit hash to its lane and colour.
   */
  private assignLanes(commits: readonly GitCommit[]): Map<string, { lane: number; color: string }> {
    const placement: Map<string, { lane: number; color: string }> = new Map<
      string,
      { lane: number; color: string }
    >();
    const lanes: LaneSlots = [];

    const allocate: (hash: string) => number = (hash: string): number => {
      const free: number = lanes.indexOf(null);
      if (free !== -1) {
        lanes[free] = hash;
        return free;
      }
      lanes.push(hash);
      return lanes.length - 1;
    };

    for (const commit of commits) {
      let lane: number = lanes.indexOf(commit.hash);
      if (lane === -1) {
        lane = allocate(commit.hash);
      }
      // Free any other lane that was also waiting for this commit (a branch point), so its lane is
      // reused below rather than drawn as a phantom parallel line.
      for (let other: number = 0; other < lanes.length; other++) {
        if (other !== lane && lanes[other] === commit.hash) {
          lanes[other] = null;
        }
      }
      placement.set(commit.hash, { lane, color: LANE_COLORS[lane % LANE_COLORS.length] });

      const [first, ...rest]: readonly string[] = commit.parents;
      lanes[lane] = first ?? null;
      for (const parent of rest) {
        if (!lanes.includes(parent)) {
          allocate(parent);
        }
      }
    }

    return placement;
  }
}
