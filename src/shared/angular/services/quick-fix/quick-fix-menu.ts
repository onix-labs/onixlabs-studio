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
}

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
    for (const { action, index } of ordered) {
      rows.push({ id: `${QUICK_FIX_ROW_PREFIX}${index}`, label: action.title });
    }
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
