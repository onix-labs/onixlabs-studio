import { DockNode, isSplitNode, reserveNodeIds } from './dock-node';
import { firstStackOfRole } from './dock-tree';

/**
 * Rebuilds a dock layout tree from a value read out of persistence: validates its structure, prunes it
 * to the panels this session can still show, and reserves its node identifiers so later ones cannot
 * collide with the restored ones.
 *
 * The persisted tree is sanitised on read rather than on write — the write path stores the tree
 * verbatim (including dynamic document-panel ids), and this function is the single authority on what
 * survives, so a schema change only has to be handled in one place.
 * @param raw The value read from the store (untrusted — may be null, malformed, or from an older schema).
 * @param knownPanelIds The panel ids still registered this session; a restored panel not in this set is
 * dropped, which naturally removes every dynamic document id that no longer exists after a restart.
 * @returns Returns a usable layout tree, or null when nothing usable survives (the caller then seeds a
 * fresh layout).
 */
export function restoreLayout(raw: unknown, knownPanelIds: ReadonlySet<string>): DockNode | null {
  if (!isPersistedNode(raw)) {
    return null;
  }
  const sanitized: DockNode | null = sanitizeNode(raw, knownPanelIds, new Set<string>());
  if (sanitized === null || firstStackOfRole(sanitized, 'document') === null) {
    return null;
  }
  reserveNodeIds(sanitized);
  return sanitized;
}

/**
 * Determines whether an untrusted value parsed from storage is a structurally valid dock node, guarding
 * the restore path against schema drift and hand-edited storage.
 * @param value The value to test.
 * @returns Returns true when the value is a well-formed {@link DockNode}.
 */
function isPersistedNode(value: unknown): value is DockNode {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const node: Record<string, unknown> = value as Record<string, unknown>;
  if (typeof node['id'] !== 'string' || node['id'].length === 0) {
    return false;
  }
  if (node['kind'] === 'stack') {
    return (
      (node['role'] === 'tool' || node['role'] === 'document') &&
      Array.isArray(node['panels']) &&
      node['panels'].every((panel: unknown): boolean => typeof panel === 'string') &&
      (node['active'] === null || typeof node['active'] === 'string') &&
      (node['collapsed'] === undefined || typeof node['collapsed'] === 'boolean')
    );
  }
  if (node['kind'] === 'split') {
    return (
      (node['dir'] === 'row' || node['dir'] === 'col') &&
      Array.isArray(node['children']) &&
      node['children'].length > 0 &&
      node['children'].every((child: unknown): boolean => isPersistedNode(child)) &&
      Array.isArray(node['sizes']) &&
      node['sizes'].length === (node['children'] as readonly unknown[]).length &&
      node['sizes'].every((size: unknown): boolean => typeof size === 'number')
    );
  }
  return false;
}

/**
 * Prunes a validated tree to the panels still known this session: drops unknown panel ids, removes
 * emptied tool stacks, and promotes single-child splits. Empty document wells are kept so reopened
 * documents have a home. Each panel id is also kept at most once across the whole tree, so a layout
 * corrupted by an earlier double-add (which would otherwise render the same panel several times) is
 * healed on restore.
 * @param node The node to prune.
 * @param known The panel ids still registered this session.
 * @param seen The panel ids already kept elsewhere in the tree, so repeats are dropped. Mutated as the
 * tree is walked.
 * @returns Returns the pruned node, or null when nothing usable survives.
 */
function sanitizeNode(
  node: DockNode,
  known: ReadonlySet<string>,
  seen: Set<string>,
): DockNode | null {
  if (isSplitNode(node)) {
    const children: DockNode[] = [];
    const sizes: number[] = [];
    node.children.forEach((child: DockNode, index: number): void => {
      const pruned: DockNode | null = sanitizeNode(child, known, seen);
      if (pruned !== null) {
        children.push(pruned);
        sizes.push(node.sizes[index]);
      }
    });
    if (children.length === 0) {
      return null;
    }
    if (children.length === 1) {
      return children[0];
    }
    return { ...node, children, sizes };
  }
  // Keep each known panel at most once across the whole tree; the first occurrence wins.
  const panels: string[] = [];
  for (const id of node.panels) {
    if (known.has(id) && !seen.has(id)) {
      panels.push(id);
      seen.add(id);
    }
  }
  if (panels.length === 0 && node.role === 'tool') {
    return null;
  }
  const active: string | null =
    node.active !== null && panels.includes(node.active) ? node.active : (panels[0] ?? null);
  return { ...node, panels, active };
}
