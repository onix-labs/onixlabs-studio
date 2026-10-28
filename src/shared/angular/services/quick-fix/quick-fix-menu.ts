import type { MenuItem } from '@shared/angular/components/menu/menu';
import type { WorkspaceTextEdits } from '@shared/angular/services/workspace-edit/workspace-edit';

/**
 * Prefixes the identifier of each row of the quick-fix menu; the rest is the action's index in the
 * list the menu was built from.
 */
export const QUICK_FIX_ROW_PREFIX: string = 'quick-fix-';

/**
 * Holds the identifier of the single row the menu shows when there is nothing to offer.
 */
export const NO_QUICK_FIXES_ROW: string = 'quick-fix-none';

/**
 * Holds the label of the single row the menu shows when there is nothing to offer.
 */
export const NO_QUICK_FIXES_LABEL: string = 'No fixes available here';

/**
 * A command a quick fix runs once its edits are applied (#1016).
 */
export interface QuickFixCommand {
  /**
   * Gets the command's title.
   */
  readonly title: string;

  /**
   * Gets the command's identifier.
   */
  readonly command: string;

  /**
   * Gets the arguments it runs with, or undefined for none.
   */
  readonly arguments?: readonly unknown[];
}

/**
 * One code action the quick-fix menu offers (#1016) — a fix, a refactor or a source action — from the
 * language server that serves the document, or from a code-action provider of Monaco's own.
 */
export interface QuickFixAction {
  /**
   * Gets the action's title, as the menu lists it.
   */
  readonly title: string;

  /**
   * Gets the action's kind (`quickfix`, `refactor.extract`, `source.organizeImports`…), or empty when
   * none was given.
   */
  readonly kind: string;

  /**
   * Gets whether it is the preferred fix for its problem.
   */
  readonly isPreferred: boolean;

  /**
   * Gets why it cannot be run here, or null when it can.
   */
  readonly disabledReason: string | null;

  /**
   * Gets the edits it makes, by file path (or model URI), or null when it makes none — or they are
   * filled in only once it is chosen.
   */
  readonly edit: WorkspaceTextEdits | null;

  /**
   * Gets the command it runs after its edits, or null for none.
   */
  readonly command: QuickFixCommand | null;

  /**
   * Gets where it came from: the language server, whose commands Studio can run, or one of Monaco's
   * providers, whose commands it does not.
   */
  readonly origin: 'server' | 'provider';

  /**
   * Fills in the action's edit and command, or null when they never need filling in.
   */
  readonly resolve: (() => Promise<QuickFixAction>) | null;

  /**
   * Gets where it sits among the server's nested actions (#1151), outermost first, or undefined.
   */
  readonly path?: readonly string[];

  /**
   * Gets the scopes a fix-all action fixes every occurrence in (#1151), or undefined for any other.
   */
  readonly fixAllScopes?: readonly string[];

  /**
   * Fills in a fix-all action's edit for one of its {@link fixAllScopes}, or undefined for any other.
   */
  readonly resolveFixAll?: (scope: string) => Promise<QuickFixAction>;

  /**
   * Gets the actions nested under it (#1151), for an action that only opens them, or undefined.
   */
  readonly children?: readonly QuickFixAction[];
}

/**
 * Identifies the action a row of the menu chooses (#1151): the path of indices to it — its index among
 * the actions offered, then among each nested group's children — and, for a fix-all, the scope.
 */
export interface QuickFixChoice {
  /**
   * Gets the indices to the action, outermost first.
   */
  readonly indices: readonly number[];

  /**
   * Gets the fix-all scope chosen, or null for the action itself.
   */
  readonly scope: string | null;
}

/**
 * Holds the order the fix-all scopes are offered in, narrowest first, with their labels (#1151).
 * A scope the server names that is not here is offered last, under its own name.
 */
const FIX_ALL_SCOPES: readonly { readonly scope: string; readonly label: string }[] = [
  { scope: 'ContainingMember', label: 'Containing Member' },
  { scope: 'ContainingType', label: 'Containing Type' },
  { scope: 'Document', label: 'Document' },
  { scope: 'Project', label: 'Project' },
  { scope: 'Solution', label: 'Solution' },
];

/**
 * Prefixes a fix-all action's title, which names the fix it fixes every occurrence of.
 */
const FIX_ALL_PREFIX: string = 'Fix All: ';

/**
 * Names the groups the menu lists actions in, in the order it lists them.
 */
type QuickFixGroup = 'fix' | 'refactor' | 'source' | 'other';

/**
 * Holds the order the menu lists its groups in.
 */
const GROUP_ORDER: readonly QuickFixGroup[] = ['fix', 'refactor', 'source', 'other'];

/**
 * Builds the rows of the quick-fix menu (#1016): the fixes first, the preferred ones at the top; then,
 * each below a divider, the refactors, the source actions (organise imports, fix all…) and anything
 * else. Within a group the actions keep their order. Actions the server marks as unable to run here
 * are not listed at all — a language server offers many such refactors on any line, and they would
 * bury the real fixes. With nothing that can run, the menu says so in one greyed row.
 * @param actions The actions, in the order they were offered.
 * @returns Returns the rows; each action's row is identified by its index in the actions.
 */
export function buildQuickFixMenu(actions: readonly QuickFixAction[]): readonly MenuItem[] {
  const groups: Map<QuickFixGroup, { action: QuickFixAction; index: number }[]> = new Map<
    QuickFixGroup,
    { action: QuickFixAction; index: number }[]
  >();
  actions.forEach((action: QuickFixAction, index: number): void => {
    if (action.disabledReason !== null) {
      return;
    }
    const group: QuickFixGroup = groupOf(action.kind);
    groups.set(group, [...(groups.get(group) ?? []), { action, index }]);
  });
  const rows: MenuItem[] = [];
  for (const group of GROUP_ORDER) {
    const entries: readonly { action: QuickFixAction; index: number }[] = groups.get(group) ?? [];
    if (entries.length === 0) {
      continue;
    }
    if (rows.length > 0) {
      rows.push({ id: `${QUICK_FIX_ROW_PREFIX}separator-${group}`, label: '', separator: true });
    }
    const ordered: readonly { action: QuickFixAction; index: number }[] = [...entries].sort(
      (
        a: { action: QuickFixAction; index: number },
        b: { action: QuickFixAction; index: number },
      ): number => rank(a.action) - rank(b.action) || a.index - b.index,
    );
    const listed: readonly QuickFixEntry[] = ordered.map(
      ({ action, index }: { action: QuickFixAction; index: number }): QuickFixEntry => ({
        action,
        id: `${QUICK_FIX_ROW_PREFIX}${index}`,
      }),
    );
    rows.push(...rowsFor(listed, listed));
  }
  if (rows.length === 0) {
    return [{ id: NO_QUICK_FIXES_ROW, label: NO_QUICK_FIXES_LABEL, disabled: true }];
  }
  return rows;
}

/**
 * Reads which action a row of the menu stands for.
 * @param id The row's identifier.
 * @returns Returns the action's index in the actions the menu was built from, or null for a row that
 * stands for none.
 */
export function quickFixIndexOf(id: string): number | null {
  if (!id.startsWith(QUICK_FIX_ROW_PREFIX)) {
    return null;
  }
  const index: number = Number(id.slice(QUICK_FIX_ROW_PREFIX.length));
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/**
 * Reads which action, and which fix-all scope, a row of the menu chooses (#1151).
 * @param id The row's identifier.
 * @returns Returns the choice, or null for a row that chooses none.
 */
export function quickFixChoiceOf(id: string): QuickFixChoice | null {
  if (!id.startsWith(QUICK_FIX_ROW_PREFIX)) {
    return null;
  }
  const [path, scope] = id.slice(QUICK_FIX_ROW_PREFIX.length).split('@');
  const indices: number[] = (path ?? '').split('/').map(Number);
  if (indices.some((index: number): boolean => !Number.isInteger(index) || index < 0)) {
    return null;
  }
  return { indices, scope: scope ?? null };
}

/**
 * An action as the menu lists it, with the identifier its row chooses it by.
 */
interface QuickFixEntry {
  readonly action: QuickFixAction;
  readonly id: string;
}

/**
 * Builds the rows for actions at one level of the menu (#1151): each action a row; a fix with a
 * fix-all partner among its siblings a submenu of Fix Here and the partner's scopes, the partner not
 * listed on its own; a fix-all with no partner a submenu of its scopes; and a group of nested actions
 * a submenu of its own.
 * @param entries The actions to list, in order.
 * @param siblings Every entry at this level, listed here or not, among which partners are found.
 * @returns Returns the rows.
 */
function rowsFor(
  entries: readonly QuickFixEntry[],
  siblings: readonly QuickFixEntry[],
): readonly MenuItem[] {
  const rows: MenuItem[] = [];
  const actions: readonly QuickFixAction[] = siblings.map(
    (entry: QuickFixEntry): QuickFixAction => entry.action,
  );
  for (const { action, id } of entries) {
    if (action.fixAllScopes !== undefined && fixedBy(action, actions) !== undefined) {
      // Folded into the fix it fixes every occurrence of.
      continue;
    }
    if (action.fixAllScopes !== undefined) {
      rows.push({ id: `${id}/scopes`, label: action.title, children: scopeRows(action, id) });
      continue;
    }
    if (action.children !== undefined && action.children.length > 0) {
      rows.push({
        id: `${id}/group`,
        label: action.title,
        children: nestedRows(
          action.children.map((child: QuickFixAction, index: number): QuickFixEntry => ({
            action: child,
            id: `${id}/${index}`,
          })),
          depthOf(action),
        ),
      });
      continue;
    }
    const partner: QuickFixEntry | undefined = siblings.find(
      (entry: QuickFixEntry): boolean =>
        entry.action.fixAllScopes !== undefined && fixedBy(entry.action, [action]) === action,
    );
    rows.push(
      partner === undefined
        ? { id, label: action.title }
        : {
            id: `${id}/fix`,
            label: action.title,
            children: [
              { id, label: 'Fix Here' },
              { id: `${id}/fix-separator`, label: '', separator: true },
              ...scopeRows(partner.action, partner.id),
            ],
          },
    );
  }
  return rows;
}

/**
 * Builds a nested group's submenu (#1151): its children grouped by the next step of their paths —
 * `Suppress CS0219 ▸ in Source`, `Configure IDE0059 severity ▸ Warning` — each group a submenu of its
 * own, and each child its own row (or, with a fix-all partner, a submenu of Fix Here and the scopes).
 * Every child keeps the identifier of its place in the group it was offered in, however deep it is
 * listed.
 * @param entries The children, with their identifiers.
 * @param depth How many steps of a child's path the levels above account for.
 * @returns Returns the rows.
 */
function nestedRows(entries: readonly QuickFixEntry[], depth: number): readonly MenuItem[] {
  const listed: readonly QuickFixEntry[] = entries.filter(
    (entry: QuickFixEntry): boolean => entry.action.disabledReason === null,
  );
  const rows: (MenuItem | { readonly step: string })[] = [];
  const groups: Map<string, QuickFixEntry[]> = new Map<string, QuickFixEntry[]>();
  for (const entry of listed) {
    const path: readonly string[] = entry.action.path ?? [];
    const step: string | undefined = path.length > depth + 1 ? path[depth] : undefined;
    if (step === undefined) {
      rows.push(...rowsFor([entry], listed));
      continue;
    }
    const group: QuickFixEntry[] | undefined = groups.get(step);
    if (group === undefined) {
      groups.set(step, [entry]);
      rows.push({ step });
    } else {
      group.push(entry);
    }
  }
  return rows.map((row: MenuItem | { readonly step: string }): MenuItem => {
    if (!('step' in row)) {
      return row;
    }
    const group: readonly QuickFixEntry[] = groups.get(row.step) ?? [];
    return {
      id: `${group[0]?.id ?? QUICK_FIX_ROW_PREFIX}/step-${depth}`,
      label: row.step,
      children: nestedRows(group, depth + 1),
    };
  });
}

/**
 * Builds a fix-all action's scope rows, narrowest first (#1151).
 * @param action The fix-all action.
 * @param id Its row identifier, which each scope's extends.
 * @returns Returns the rows.
 */
function scopeRows(action: QuickFixAction, id: string): readonly MenuItem[] {
  const offered: readonly string[] = action.fixAllScopes ?? [];
  const known: readonly MenuItem[] = FIX_ALL_SCOPES.filter(
    ({ scope }: { scope: string }): boolean => offered.includes(scope),
  ).map(({ scope, label }: { scope: string; label: string }): MenuItem => ({
    id: `${id}@${scope}`,
    label: `Fix All in ${label}`,
  }));
  const other: readonly MenuItem[] = offered
    .filter(
      (scope: string): boolean =>
        !FIX_ALL_SCOPES.some((entry: { scope: string }): boolean => entry.scope === scope),
    )
    .map((scope: string): MenuItem => ({ id: `${id}@${scope}`, label: `Fix All in ${scope}` }));
  return [...known, ...other];
}

/**
 * Finds the fix a fix-all action fixes every occurrence of, among its siblings: the one at the same
 * path, or — where the server gives no paths — the one its title names.
 * @param fixAll The fix-all action.
 * @param siblings The actions beside it.
 * @returns Returns the fix, or undefined when it has none.
 */
function fixedBy(
  fixAll: QuickFixAction,
  siblings: readonly QuickFixAction[],
): QuickFixAction | undefined {
  const title: string = fixAll.title.startsWith(FIX_ALL_PREFIX)
    ? fixAll.title.slice(FIX_ALL_PREFIX.length)
    : fixAll.title;
  return siblings.find(
    (candidate: QuickFixAction): boolean =>
      candidate !== fixAll &&
      candidate.fixAllScopes === undefined &&
      candidate.disabledReason === null &&
      (fixAll.path !== undefined && candidate.path !== undefined
        ? samePath(fixAll.path, candidate.path)
        : candidate.title === title),
  );
}

/**
 * Determines whether two paths are the same.
 * @param a One path.
 * @param b The other.
 * @returns Returns true when they are.
 */
function samePath(a: readonly string[], b: readonly string[]): boolean {
  return (
    a.length === b.length && a.every((step: string, index: number): boolean => step === b[index])
  );
}

/**
 * Gets how many steps of its children's paths a nested group accounts for: its own path's length, or
 * one where the server gave it none.
 * @param action The group.
 * @returns Returns the depth.
 */
function depthOf(action: QuickFixAction): number {
  return Math.max(action.path?.length ?? 1, 1);
}

/**
 * Determines whether an action is a fix: its kind is `quickfix`, one below it, or none at all.
 * @param kind The action's kind.
 * @returns Returns true when it is.
 */
export function isQuickFixKind(kind: string): boolean {
  return kind === '' || kind === 'quickfix' || kind.startsWith('quickfix.');
}

/**
 * Sorts an action into the menu's groups by its kind.
 * @param kind The action's kind.
 * @returns Returns its group.
 */
function groupOf(kind: string): QuickFixGroup {
  if (isQuickFixKind(kind)) {
    return 'fix';
  }
  if (kind === 'refactor' || kind.startsWith('refactor.')) {
    return 'refactor';
  }
  if (kind === 'source' || kind.startsWith('source.')) {
    return 'source';
  }
  return 'other';
}

/**
 * Ranks an action within its group: preferred first, then the rest.
 * @param action The action.
 * @returns Returns its rank, lowest first.
 */
function rank(action: QuickFixAction): number {
  return action.isPreferred ? 0 : 1;
}
