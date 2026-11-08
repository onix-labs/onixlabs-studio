import type {
  TestLocation,
  TestNode,
  TestNodeKind,
  TestOutcome,
  TestResult,
  TestStackFrame,
} from '@shared/api/test-adapter-protocol';

// The Tests panel's tree, as data (#1352): the adapters' discovered trees with the tests only a run
// found merged in, each node's state rolled up from its tests, and the rows the panel draws. Pure, so
// it is specced without a component, a bridge or a plugin.

/**
 * Says what the panel shows for a node: how it last came out, that it is running or waiting to, or
 * that it has not run.
 */
export type TestStatus = TestOutcome | 'running' | 'queued' | 'none';

/**
 * Describes how one test last came out.
 */
export interface TestState {
  /**
   * Gets how it came out.
   */
  readonly outcome: TestOutcome;

  /**
   * Gets how long it took, in milliseconds.
   */
  readonly durationMs?: number;

  /**
   * Gets the failure's message, or the reason it was skipped.
   */
  readonly message?: string;

  /**
   * Gets the failure's stack.
   */
  readonly stack?: readonly TestStackFrame[];

  /**
   * Gets what it wrote while it ran.
   */
  readonly output?: string;
}

/**
 * Describes one node of the merged tree, where the panel can find it.
 */
export interface TestEntry {
  /**
   * Gets the node's key, unique across every adapter: its plugin and its identifier.
   */
  readonly key: string;

  /**
   * Gets the plugin that found it.
   */
  readonly pluginId: string;

  /**
   * Gets the node.
   */
  readonly node: TestNode;

  /**
   * Gets the key of the node above it, or null for a root.
   */
  readonly parentKey: string | null;

  /**
   * Gets the framework it belongs to, inherited from the nearest ancestor naming one.
   */
  readonly framework: string | undefined;

  /**
   * Gets the keys of every test at or beneath it.
   */
  readonly tests: readonly string[];
}

/**
 * Describes what a row of the panel's tree shows.
 */
export interface TestRowData {
  /**
   * Gets the node.
   */
  readonly entry: TestEntry;

  /**
   * Gets its status, rolled up from its tests for a group.
   */
  readonly status: TestStatus;

  /**
   * Gets how many of its tests failed or errored, for a group.
   */
  readonly failed: number;

  /**
   * Gets how long it took, in milliseconds: a test's own time, or the sum of a group's.
   */
  readonly durationMs: number | undefined;
}

/**
 * Describes a whole tree's tallies, for the status strip.
 */
export interface TestTotals {
  readonly tests: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly notRun: number;
}

/**
 * Builds the key of a node: its plugin and identifier.
 * @param pluginId The plugin.
 * @param id The node's identifier.
 * @returns Returns the key.
 */
export function testKey(pluginId: string, id: string): string {
  return `${pluginId}\u0000${id}`;
}

/**
 * Reads a key's identifier back.
 * @param key The key.
 * @returns Returns the node identifier.
 */
export function idOfKey(key: string): string {
  return key.slice(key.indexOf('\u0000') + 1);
}

/**
 * Merges the tests only a run found — one case of a theory, one instance of a parametrised test — into
 * a discovered tree, under the node each names as its parent. A result whose parent is unknown joins the
 * first root, so nothing a run reported is hidden.
 * @param roots The discovered roots.
 * @param found The run-found tests, keyed by their parent's identifier.
 * @returns Returns the merged roots.
 */
export function mergeFound(
  roots: readonly TestNode[],
  found: ReadonlyMap<string, readonly TestNode[]>,
): readonly TestNode[] {
  if (found.size === 0) {
    return roots;
  }
  const known: Set<string> = new Set<string>();
  const collect: (node: TestNode) => void = (node: TestNode): void => {
    known.add(node.id);
    node.children?.forEach(collect);
  };
  roots.forEach(collect);
  const merge: (node: TestNode) => TestNode = (node: TestNode): TestNode => {
    const extra: readonly TestNode[] = (found.get(node.id) ?? []).filter(
      (candidate: TestNode): boolean => !known.has(candidate.id),
    );
    const children: readonly TestNode[] | undefined = node.children?.map(merge);
    if (extra.length === 0) {
      return children === node.children ? node : { ...node, children };
    }
    return { ...node, children: [...(children ?? []), ...extra] };
  };
  const merged: TestNode[] = roots.map(merge);
  const orphans: readonly TestNode[] = [...found.entries()]
    .filter(([parent]: [string, readonly TestNode[]]): boolean => !known.has(parent))
    .flatMap(([, nodes]: [string, readonly TestNode[]]): readonly TestNode[] => nodes)
    .filter((node: TestNode): boolean => !known.has(node.id));
  if (orphans.length > 0 && merged.length > 0) {
    merged[0] = { ...merged[0], children: [...(merged[0].children ?? []), ...orphans] };
  }
  return merged;
}

/**
 * Turns a result for a test only a run found into the node it adds.
 * @param result The result.
 * @returns Returns the node.
 */
export function nodeOfResult(result: TestResult): TestNode {
  return {
    id: result.id,
    label: result.label ?? result.id,
    kind: 'test',
    ...(result.location === undefined ? {} : { location: result.location }),
  };
}

/**
 * Indexes an adapter's tree by key, depth first, so the panel can find any node and its tests.
 * @param pluginId The plugin.
 * @param roots The roots.
 * @param into The index to add to, in tree order.
 */
export function indexTree(
  pluginId: string,
  roots: readonly TestNode[],
  into: Map<string, TestEntry>,
): void {
  const visit: (
    node: TestNode,
    parentKey: string | null,
    framework: string | undefined,
  ) => readonly string[] = (
    node: TestNode,
    parentKey: string | null,
    framework: string | undefined,
  ): readonly string[] => {
    const key: string = testKey(pluginId, node.id);
    const inherited: string | undefined = node.framework ?? framework;
    // Reserved first, so the entry keeps its place in tree order ahead of its children.
    into.set(key, { key, pluginId, node, parentKey, framework: inherited, tests: [] });
    const tests: string[] = node.kind === 'test' ? [key] : [];
    for (const child of node.children ?? []) {
      tests.push(...visit(child, key, inherited));
    }
    into.set(key, { key, pluginId, node, parentKey, framework: inherited, tests });
    return tests;
  };
  for (const root of roots) {
    visit(root, null, undefined);
  }
}

/**
 * Rolls a node's status up from its tests: running while any runs; failed while any failed or errored;
 * otherwise passed when any passed, skipped when all were skipped, and not run when none has.
 * @param tests The keys of its tests.
 * @param states Each test's last state.
 * @param running The tests running now.
 * @param queued The tests waiting to run.
 * @returns Returns the status.
 */
export function rollUp(
  tests: readonly string[],
  states: ReadonlyMap<string, TestState>,
  running: ReadonlySet<string>,
  queued: ReadonlySet<string>,
): TestStatus {
  let passed: boolean = false;
  let skipped: boolean = false;
  let failed: boolean = false;
  let errored: boolean = false;
  let anyQueued: boolean = false;
  for (const key of tests) {
    if (running.has(key)) {
      return 'running';
    }
    anyQueued ||= queued.has(key);
    const outcome: TestOutcome | undefined = states.get(key)?.outcome;
    failed ||= outcome === 'failed';
    errored ||= outcome === 'errored';
    passed ||= outcome === 'passed';
    skipped ||= outcome === 'skipped';
  }
  if (anyQueued) {
    return 'queued';
  }
  if (failed) {
    return 'failed';
  }
  if (errored) {
    return 'errored';
  }
  if (passed) {
    return 'passed';
  }
  return skipped ? 'skipped' : 'none';
}

/**
 * Counts a tree's tests by how they last came out.
 * @param index The merged tree.
 * @param states Each test's last state.
 * @returns Returns the tallies.
 */
export function totals(
  index: ReadonlyMap<string, TestEntry>,
  states: ReadonlyMap<string, TestState>,
): TestTotals {
  let tests: number = 0;
  let passed: number = 0;
  let failed: number = 0;
  let skipped: number = 0;
  for (const entry of index.values()) {
    if (entry.node.kind !== 'test') {
      continue;
    }
    tests += 1;
    const outcome: TestOutcome | undefined = states.get(entry.key)?.outcome;
    if (outcome === 'passed') {
      passed += 1;
    } else if (outcome === 'failed' || outcome === 'errored') {
      failed += 1;
    } else if (outcome === 'skipped') {
      skipped += 1;
    }
  }
  return { tests, passed, failed, skipped, notRun: tests - passed - failed - skipped };
}

/**
 * Describes how the rows are drawn.
 */
export interface RowOptions {
  /**
   * Gets the keys of the folded groups.
   */
  readonly collapsed: ReadonlySet<string>;

  /**
   * Gets whether only failed tests, and the groups holding them, are shown.
   */
  readonly failedOnly: boolean;
}

/**
 * Describes one drawn row.
 */
export interface TestRow {
  readonly key: string;
  readonly depth: number;
  readonly expandable: boolean;
  readonly expanded: boolean;
  readonly data: TestRowData;
}

/**
 * Lays the merged tree out as rows, in tree order, folded groups hiding what is beneath them.
 * @param index The merged tree.
 * @param states Each test's last state.
 * @param running The tests running now.
 * @param queued The tests waiting to run.
 * @param options How the rows are drawn.
 * @returns Returns the rows.
 */
export function layoutRows(
  index: ReadonlyMap<string, TestEntry>,
  states: ReadonlyMap<string, TestState>,
  running: ReadonlySet<string>,
  queued: ReadonlySet<string>,
  options: RowOptions,
): readonly TestRow[] {
  const rows: TestRow[] = [];
  // What is not drawn: a folded group's descendants, and with failed-only, what holds no failure.
  // The index is in tree order, so a parent is always decided before its children.
  const hidden: Set<string> = new Set<string>();
  const depths: Map<string, number> = new Map<string, number>();
  const isFailed: (key: string) => boolean = (key: string): boolean => {
    const outcome: TestOutcome | undefined = states.get(key)?.outcome;
    return outcome === 'failed' || outcome === 'errored';
  };
  for (const entry of index.values()) {
    if (entry.parentKey !== null && hidden.has(entry.parentKey)) {
      hidden.add(entry.key);
      continue;
    }
    const failed: number = entry.tests.filter(isFailed).length;
    if (options.failedOnly && failed === 0) {
      hidden.add(entry.key);
      continue;
    }
    const depth: number = entry.parentKey === null ? 0 : (depths.get(entry.parentKey) ?? -1) + 1;
    depths.set(entry.key, depth);
    const expandable: boolean = (entry.node.children?.length ?? 0) > 0;
    const expanded: boolean = expandable && !options.collapsed.has(entry.key);
    if (expandable && !expanded) {
      hidden.add(entry.key);
    }
    let duration: number | undefined;
    for (const key of entry.tests) {
      const ms: number | undefined = states.get(key)?.durationMs;
      if (ms !== undefined) {
        duration = (duration ?? 0) + ms;
      }
    }
    rows.push({
      key: entry.key,
      depth,
      expandable,
      expanded,
      data: {
        entry,
        status: rollUp(entry.tests, states, running, queued),
        failed,
        durationMs: duration,
      },
    });
  }
  return rows;
}

/**
 * The furthest a test's declaration may be from the line asked about and still be the test there: a
 * lens can sit on an attribute above the name, or the name below its attributes.
 */
const NEAR_LINES: number = 3;

/**
 * Finds the node a source line declares: the one declared on it, or failing that the nearest within
 * {@link NEAR_LINES}, preferring a test to a suite.
 * @param index The merged tree.
 * @param path The file's absolute path.
 * @param line The 1-based line.
 * @returns Returns the entry, or undefined when the line declares none.
 */
export function entryAt(
  index: ReadonlyMap<string, TestEntry>,
  path: string,
  line: number,
): TestEntry | undefined {
  let best: TestEntry | undefined;
  let bestScore: number = Number.POSITIVE_INFINITY;
  const rank: Readonly<Record<TestNodeKind, number>> = { test: 0, suite: 1, file: 2, project: 3 };
  for (const entry of index.values()) {
    const location: TestLocation | undefined = entry.node.location;
    if (location?.file !== path) {
      continue;
    }
    const distance: number = Math.abs(location.line - line);
    if (distance > NEAR_LINES) {
      continue;
    }
    const score: number = distance * 10 + rank[entry.node.kind];
    if (score < bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Formats a duration the way the panel shows it.
 * @param ms The duration in milliseconds.
 * @returns Returns the text, such as `12 ms` or `1.4 s`.
 */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) {
    return '';
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  return ms < 60_000
    ? `${(ms / 1000).toFixed(1)} s`
    : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}
